import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events for subscription management
 *
 * Important: This endpoint must be configured in Stripe Dashboard
 * Events to listen for:
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 * - invoice.payment_succeeded
 * - invoice.payment_failed
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET environment variable');
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    );
  }

  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Error handling webhook event:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

/**
 * Handle subscription created or updated
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  const currentPeriodEnd = new Date((subscription as any).current_period_end * 1000).toISOString();

  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not initialized');
  }

  // Get candidate by stripe_customer_id
  const { data: candidate, error: fetchError } = await supabaseAdmin
    .from('candidates')
    .select('email')
    .eq('stripe_customer_id', customerId)
    .single();

  if (fetchError || !candidate) {
    console.error('Could not find candidate for customer:', customerId);
    return;
  }

  // Update candidate subscription status
  const updateData: any = {
    stripe_subscription_id: subscriptionId,
    subscription_status: status,
    subscription_current_period_end: currentPeriodEnd,
  };

  // Set subscription tier based on status
  if (status === 'active' || status === 'trialing') {
    updateData.subscription_tier = 'premium';
  }

  const { error: updateError } = await supabaseAdmin
    .from('candidates')
    .update(updateData)
    .eq('email', candidate.email);

  if (updateError) {
    console.error('Error updating candidate subscription:', updateError);
    throw updateError;
  }

  console.log(`✅ Updated subscription for ${candidate.email}: ${status}`);
}

/**
 * Handle subscription deleted (cancellation)
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not initialized');
  }

  const { data: candidate, error: fetchError } = await supabaseAdmin
    .from('candidates')
    .select('email')
    .eq('stripe_customer_id', customerId)
    .single();

  if (fetchError || !candidate) {
    console.error('Could not find candidate for customer:', customerId);
    return;
  }

  // Downgrade to free tier
  const { error: updateError } = await supabaseAdmin
    .from('candidates')
    .update({
      subscription_tier: 'free',
      subscription_status: 'canceled',
      stripe_subscription_id: null,
    })
    .eq('email', candidate.email);

  if (updateError) {
    console.error('Error downgrading candidate:', updateError);
    throw updateError;
  }

  console.log(`✅ Downgraded ${candidate.email} to free tier`);
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const subscriptionId = typeof (invoice as any).subscription === 'string' ? (invoice as any).subscription : (invoice as any).subscription?.id;

  if (!subscriptionId) {
    return; // Not a subscription payment
  }

  console.log(`✅ Payment succeeded for customer ${customerId}`);

  // Subscription status will be updated via subscription.updated event
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not initialized');
  }

  const { data: candidate, error: fetchError } = await supabaseAdmin
    .from('candidates')
    .select('email')
    .eq('stripe_customer_id', customerId)
    .single();

  if (fetchError || !candidate) {
    console.error('Could not find candidate for customer:', customerId);
    return;
  }

  // Update subscription status to past_due
  const { error: updateError } = await supabaseAdmin
    .from('candidates')
    .update({
      subscription_status: 'past_due',
    })
    .eq('email', candidate.email);

  if (updateError) {
    console.error('Error updating payment status:', updateError);
    throw updateError;
  }

  console.log(`⚠️ Payment failed for ${candidate.email}`);
}
