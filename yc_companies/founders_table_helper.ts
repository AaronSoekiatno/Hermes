/**
 * Founders Table Helper Functions
 *
 * Helper functions for working with the new founders table.
 * Provides an easy transition from CSV columns to relational structure.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { FounderInfo } from './founder_email_discovery';

export interface FounderRecord {
  id?: string;
  startup_id: string;
  name: string;
  email?: string;
  role?: string;
  linkedin_url?: string;
  twitter_url?: string;
  personal_website?: string;
  university?: string;
  degree?: string;
  graduation_year?: number;
  previous_company?: string;
  previous_role?: string;
  background?: string;
  email_source?: string;
  email_verified?: boolean;
  email_verification_date?: string;
  email_confidence?: number;
  needs_manual_review?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Insert or update founders for a startup
 *
 * @param supabase - Supabase client
 * @param startupId - Startup ID
 * @param founders - Array of founder info from email discovery
 * @returns Number of founders inserted/updated
 */
export async function upsertFounders(
  supabase: SupabaseClient,
  startupId: string,
  founders: FounderInfo[]
): Promise<number> {
  if (founders.length === 0) {
    console.log('     No founders to insert');
    return 0;
  }

  console.log(`     Upserting ${founders.length} founder(s) to founders table...`);

  // Convert FounderInfo to FounderRecord
  const founderRecords: FounderRecord[] = founders.map(f => ({
    startup_id: startupId,
    name: f.name,
    email: f.email,
    role: f.role,
    linkedin_url: f.linkedin,
    background: f.background,
    email_source: f.emailSource,
    email_verified: f.email ? true : false,
    email_confidence: f.confidence,
    needs_manual_review: f.emailSource === 'hunter.io' && !f.email,
  }));

  // Check if founders already exist for this startup
  const { data: existing, error: checkError } = await supabase
    .from('founders')
    .select('id, name, email')
    .eq('startup_id', startupId);

  if (checkError) {
    console.error('     ❌ Error checking existing founders:', checkError.message);
    throw checkError;
  }

  if (existing && existing.length > 0) {
    console.log(`     Found ${existing.length} existing founders - will update`);

    // Update existing founders by name matching
    for (const founderRecord of founderRecords) {
      const existingFounder = existing.find(e =>
        e.name.toLowerCase() === founderRecord.name.toLowerCase()
      );

      if (existingFounder) {
        // Update existing founder
        const { error: updateError } = await supabase
          .from('founders')
          .update({
            email: founderRecord.email || existingFounder.email,
            role: founderRecord.role,
            linkedin_url: founderRecord.linkedin_url,
            background: founderRecord.background,
            email_source: founderRecord.email_source || existingFounder.email,
            email_verified: founderRecord.email_verified,
            email_confidence: founderRecord.email_confidence,
            needs_manual_review: founderRecord.needs_manual_review,
          })
          .eq('id', existingFounder.id);

        if (updateError) {
          console.error(`     ❌ Error updating founder ${founderRecord.name}:`, updateError.message);
        } else {
          console.log(`     ✅ Updated founder: ${founderRecord.name}`);
        }
      } else {
        // Insert new founder (not found in existing)
        const { error: insertError } = await supabase
          .from('founders')
          .insert([founderRecord]);

        if (insertError) {
          console.error(`     ❌ Error inserting founder ${founderRecord.name}:`, insertError.message);
        } else {
          console.log(`     ✅ Inserted new founder: ${founderRecord.name}`);
        }
      }
    }

    return founderRecords.length;
  } else {
    // No existing founders - insert all
    const { data, error } = await supabase
      .from('founders')
      .insert(founderRecords)
      .select();

    if (error) {
      console.error('     ❌ Error inserting founders:', error.message);
      throw error;
    }

    console.log(`     ✅ Inserted ${data?.length || 0} founders`);
    return data?.length || 0;
  }
}

/**
 * Get founders for a startup
 *
 * @param supabase - Supabase client
 * @param startupId - Startup ID
 * @returns Array of founder records
 */
export async function getFounders(
  supabase: SupabaseClient,
  startupId: string
): Promise<FounderRecord[]> {
  const { data, error } = await supabase
    .from('founders')
    .select('*')
    .eq('startup_id', startupId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching founders:', error.message);
    throw error;
  }

  return data || [];
}

/**
 * Get all founders needing manual review
 *
 * @param supabase - Supabase client
 * @param limit - Max number to return
 * @returns Array of founder records with startup info
 */
export async function getFoundersNeedingReview(
  supabase: SupabaseClient,
  limit: number = 50
): Promise<any[]> {
  const { data, error } = await supabase
    .from('founders_with_startup')
    .select('*')
    .eq('needs_manual_review', true)
    .is('email', null)
    .limit(limit);

  if (error) {
    console.error('Error fetching founders needing review:', error.message);
    throw error;
  }

  return data || [];
}

/**
 * Update founder email after manual Hunter.io lookup
 *
 * @param supabase - Supabase client
 * @param founderId - Founder ID
 * @param email - Verified email
 * @returns Success boolean
 */
export async function updateFounderEmail(
  supabase: SupabaseClient,
  founderId: string,
  email: string,
  emailSource: string = 'hunter.io'
): Promise<boolean> {
  const { error } = await supabase
    .from('founders')
    .update({
      email,
      email_source: emailSource,
      email_verified: true,
      email_verification_date: new Date().toISOString(),
      email_confidence: 1.0, // Manual verification = 100% confidence
      needs_manual_review: false,
    })
    .eq('id', founderId);

  if (error) {
    console.error('Error updating founder email:', error.message);
    return false;
  }

  return true;
}

/**
 * Convert FounderRecord array to CSV strings (for backward compatibility)
 *
 * @param founders - Array of founder records
 * @returns Object with CSV strings
 */
export function foundersToCSV(founders: FounderRecord[]): {
  founder_names: string;
  founder_emails: string;
  founder_linkedin: string;
} {
  const names = founders.map(f => f.name).join(', ');
  const emails = founders.map(f => f.email || '').filter(e => e).join(', ');
  const linkedins = founders.map(f => f.linkedin_url || '').filter(l => l).join(', ');

  return {
    founder_names: names,
    founder_emails: emails,
    founder_linkedin: linkedins,
  };
}

/**
 * Search founders by university (for student matching)
 *
 * @param supabase - Supabase client
 * @param university - University name
 * @param limit - Max results
 * @returns Founders with startup info
 */
export async function findFoundersByUniversity(
  supabase: SupabaseClient,
  university: string,
  limit: number = 50
): Promise<any[]> {
  const { data, error } = await supabase
    .from('founders_with_startup')
    .select('*')
    .ilike('university', `%${university}%`)
    .not('email', 'is', null)
    .limit(limit);

  if (error) {
    console.error('Error searching founders by university:', error.message);
    throw error;
  }

  return data || [];
}

/**
 * Search founders by previous company (for warm intros)
 *
 * @param supabase - Supabase client
 * @param company - Company name
 * @param limit - Max results
 * @returns Founders with startup info
 */
export async function findFoundersByPreviousCompany(
  supabase: SupabaseClient,
  company: string,
  limit: number = 50
): Promise<any[]> {
  const { data, error } = await supabase
    .from('founders_with_startup')
    .select('*')
    .ilike('previous_company', `%${company}%`)
    .not('email', 'is', null)
    .limit(limit);

  if (error) {
    console.error('Error searching founders by previous company:', error.message);
    throw error;
  }

  return data || [];
}
