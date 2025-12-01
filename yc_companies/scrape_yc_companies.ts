import { resolve } from 'path';
import { config } from 'dotenv';
// Load .env.local file
config({ path: resolve(process.cwd(), '.env.local') });

import { randomUUID } from 'crypto';
import puppeteer, { Browser, Page } from 'puppeteer';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as csv from 'csv-parse/sync';

// Types
interface YCCompany {
  YC_Link?: string;
  YC_link?: string; // Alternative column name
  Company_Logo?: string;
  Company_Name: string;
  company_description: string;
  Batch: string;
  business_type?: string;
  industry?: string;
  Industry?: string; // Alternative column name
  'Sub-Industry'?: string;
  location?: string;
  Location?: string; // Alternative column name
}

interface YCPageData {
  founders: Array<{
    firstName: string;
    lastName: string;
    linkedIn: string;
    description?: string; // Founder bio/description
  }>;
  website: string;
  teamSize: string;
  jobPostings: Array<{
    title: string;
    description: string;
    location?: string; // Job location
  }>;
  location: string;
  oneLineSummary: string;
}

interface EnrichedYCData extends YCCompany {
  founder_first_name: string;
  founder_last_name: string;
  founder_linkedin: string;
  website: string;
  team_size: string;
  job_openings: string;
  hiring_roles: string;
}

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

/**
 * Normalize company data to handle both CSV formats
 */
function normalizeCompanyData(company: YCCompany): {
  ycLink: string;
  companyLogo: string;
  companyName: string;
  description: string;
  batch: string;
  businessType: string;
  industry: string;
  location: string;
} {
  return {
    ycLink: company.YC_Link || company.YC_link || '',
    companyLogo: company.Company_Logo || '',
    companyName: company.Company_Name || '',
    description: company.company_description || '',
    batch: company.Batch || '',
    businessType: company.business_type || '',
    industry: company.industry || company.Industry || company['Sub-Industry'] || '',
    location: company.location || company.Location || '',
  };
}

/**
 * Extract company slug from YC URL
 */
function extractCompanySlug(ycLink: string): string | null {
  const match = ycLink.match(/\/companies\/([^/?]+)/);
  return match ? match[1] : null;
}

/**
 * Load companies from CSV file
 */
function loadCompaniesFromCSV(csvPath: string): YCCompany[] {
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = csv.parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  });
  return records as YCCompany[];
}

/**
 * Get all CSV files from yc_companies directory
 */
function getAllYCCsvFiles(): string[] {
  const ycDir = resolve(process.cwd(), 'yc_companies');
  const files = fs.readdirSync(ycDir);
  return files
    .filter(file => (file.startsWith('ycombinator') || file.toLowerCase().includes('yc')) && file.endsWith('.csv'))
    .map(file => resolve(ycDir, file))
    .sort(); // Sort for consistent ordering
}

/**
 * Scrape YC company page for founder, job, and company data
 * Enhanced with better selectors, founder descriptions, and jobs page scraping
 */
async function scrapeYCCompanyPage(page: Page, ycUrl: string): Promise<YCPageData | null> {
  try {
    console.log(`   Navigating to: ${ycUrl}`);
    
    // Navigate with better error handling
    try {
      await page.goto(ycUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (navError) {
      console.error(`   ⚠️  Navigation error: ${navError instanceof Error ? navError.message : String(navError)}`);
      // Try with domcontentloaded as fallback
      try {
        await page.goto(ycUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (fallbackError) {
        console.error(`   ❌ Failed to load page: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        return null;
      }
    }

    // Wait for content to load
    try {
      await page.waitForSelector('body', { timeout: 10000 });
    } catch (error) {
      console.warn(`   ⚠️  Body selector timeout, continuing anyway...`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Scroll to trigger lazy-loaded content
    try {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (scrollError) {
      console.warn(`   ⚠️  Scroll error (non-critical): ${scrollError instanceof Error ? scrollError.message : String(scrollError)}`);
    }

    // Check if page loaded correctly
    const pageTitle = await page.title();
    console.log(`   Page title: ${pageTitle}`);
    
    // Check for common error pages
    const isErrorPage = await page.evaluate(() => {
      const bodyText = document.body.textContent?.toLowerCase() || '';
      return bodyText.includes('404') || 
             bodyText.includes('not found') || 
             bodyText.includes('page not found') ||
             bodyText.includes('access denied');
    });
    
    if (isErrorPage) {
      console.error(`   ❌ Page appears to be an error page (404/not found)`);
      return null;
    }

    const pageData = await page.evaluate(() => {
      try {
      const data: YCPageData = {
        founders: [],
        website: '',
        teamSize: '',
        jobPostings: [],
        location: '',
        oneLineSummary: '',
      };

      // ============================================
      // 1. EXTRACT FOUNDERS WITH DESCRIPTIONS
      // ============================================
      // Strategy: Find "Active Founders" section, then extract from actual YC page structure
      // YC uses: <div class="text-xl font-bold"> for names and <div class="prose max-w-full whitespace-pre-line"> for descriptions
      
      // First, get the company name to filter it out
      const companyName = (document.querySelector('h1')?.textContent?.trim() || '').toLowerCase();
      
      // Find "Active Founders" heading
      const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const foundersHeading = allHeadings.find(h => {
        const text = h.textContent?.trim() || '';
        return text.toLowerCase().includes('active founders') || 
               text.toLowerCase() === 'founders';
      });
      
      // Track seen founders to avoid duplicates
      const seenFounders = new Set<string>(); // Track by LinkedIn URL or full name

      // Find the container with founder cards
      let foundersContainer: Element | null = null;
      
      if (foundersHeading) {
        // Look for container with founder cards - typically a parent or sibling
        let current: Element | null = foundersHeading.parentElement;
        while (current && !foundersContainer) {
          // Check if this container has founder name elements
          const nameElements = current.querySelectorAll('.text-xl.font-bold, div[class*="text-xl"][class*="font-bold"]');
          if (nameElements.length > 0) {
            foundersContainer = current;
            break;
          }
          current = current.parentElement;
        }
      }
      
      // If no heading found, try to find founder cards directly
      if (!foundersContainer) {
        const nameElements = document.querySelectorAll('.text-xl.font-bold, div[class*="text-xl"][class*="font-bold"]');
        if (nameElements.length > 0) {
          // Find common parent of all name elements
          const parents = Array.from(nameElements).map(el => el.parentElement).filter(Boolean);
          if (parents.length > 0) {
            // Find the deepest common ancestor
            let commonParent = parents[0];
            for (let i = 1; i < parents.length && commonParent; i++) {
              while (commonParent && !commonParent.contains(parents[i] as Node)) {
                commonParent = commonParent.parentElement;
              }
            }
            foundersContainer = commonParent;
          }
        }
      }
      
      if (foundersContainer) {
        // Find all founder name elements in the container
        const nameElements = foundersContainer.querySelectorAll('.text-xl.font-bold, div[class*="text-xl"][class*="font-bold"]');
        
        nameElements.forEach(nameEl => {
          const fullName = nameEl.textContent?.trim() || '';
          
          if (!fullName || fullName.length < 3 || fullName.length > 100) return;
          
          // Skip if it's not a person's name (has numbers, special chars, etc.)
          if (!/^[A-Za-z\s\.\-\']+$/.test(fullName)) return;
          
          // Find the founder card container (parent that likely contains both name and description)
          let founderCard = nameEl.parentElement;
          let attempts = 0;
          while (founderCard && attempts < 5) {
            // Check if this container has a description element
            const descEl = founderCard.querySelector('.prose.max-w-full.whitespace-pre-line, div[class*="prose"][class*="max-w-full"]');
            if (descEl) {
              break; // Found the right container
            }
            founderCard = founderCard.parentElement;
            attempts++;
          }
          
          // If no card found, use the name element's parent
          if (!founderCard) {
            founderCard = nameEl.parentElement;
          }
          
          // Extract description
          let description = '';
          
          // Try to find description in prose div
          const proseDiv = founderCard?.querySelector('.prose.max-w-full.whitespace-pre-line, div[class*="prose"][class*="max-w-full"]') as HTMLElement;
          if (proseDiv) {
            description = proseDiv.textContent?.trim() || '';
          }
          
          // Fallback: Try to find ForwardRef component with content attribute
          if (!description && founderCard) {
            // Look for elements that might have the description in a content attribute
            const forwardRef = founderCard.querySelector('[content]') as HTMLElement;
            if (forwardRef) {
              const contentAttr = forwardRef.getAttribute('content');
              if (contentAttr && contentAttr.length > 20) {
                description = contentAttr;
              }
            }
          }
          
          // Fallback: Look for paragraph text in the founder card
          if (!description && founderCard) {
            const paragraphs = founderCard.querySelectorAll('p');
            for (const p of Array.from(paragraphs)) {
              const pText = p.textContent?.trim() || '';
              // Description is usually longer and contains "Co-founder" or similar
              if (pText.length > 30 && 
                  pText.length < 1000 && 
                  (pText.includes('Co-founder') || pText.includes('Founder') || 
                   pText.includes('Prior') || pText.includes('studied') || 
                   pText.includes('worked') || pText.includes('led'))) {
                description = pText;
                break;
              }
            }
          }
          
          // Extract LinkedIn link - look for LinkedIn link near this founder card
          let linkedIn = '';
          if (founderCard) {
            const linkedInLink = founderCard.querySelector('a[href*="linkedin.com"]') as HTMLAnchorElement;
            if (linkedInLink) {
              linkedIn = linkedInLink.href;
            }
          }
          
          // Skip if this is the company name
          if (fullName.toLowerCase() === companyName) return;
          
          // Skip if name is too short or looks like a company name (single word, all caps, etc.)
          if (fullName.split(/\s+/).length < 2) return;
          if (fullName === fullName.toUpperCase() && fullName.length > 10) return; // Likely company name
          
          // Only include if description mentions "founder" or we're in the Active Founders section
          const isInFoundersSection = foundersHeading && 
            (foundersContainer?.contains(nameEl) || false);
          const hasFounderDescription = description.toLowerCase().includes('founder') || 
                                       description.toLowerCase().includes('co-founder');
          
          if (!isInFoundersSection && !hasFounderDescription) return;
          
          // Split name into first and last
          const nameParts = fullName.trim().split(/\s+/);
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';
          
          // Create unique key for deduplication
          const founderKey = linkedIn || fullName.toLowerCase();
          
          // Skip if we've already seen this founder
          if (seenFounders.has(founderKey)) return;
          seenFounders.add(founderKey);
          
          // Only add if we have at least a first name
          if (firstName) {
            data.founders.push({
              firstName,
              lastName,
              linkedIn,
              description: description || undefined,
            });
          }
        });
      }
      
      // Fallback: If still no founders found, try finding by LinkedIn links
      if (data.founders.length === 0) {
        const allLinkedInLinks = document.querySelectorAll('a[href*="linkedin.com/in/"]');
        
        allLinkedInLinks.forEach(link => {
          const linkedIn = (link as HTMLAnchorElement).href;
          
          // Skip if we've already seen this LinkedIn
          if (seenFounders.has(linkedIn)) return;
          
          // Skip if it's in navigation or footer
          const parent = link.closest('nav, footer, header');
          if (parent) return;
          
          // Find nearby name - look for text-xl font-bold div
          const container = link.closest('div, section, article') || link.parentElement;
          if (!container) return;
          
          const nameEl = container.querySelector('.text-xl.font-bold, div[class*="text-xl"][class*="font-bold"]') as HTMLElement;
          if (nameEl) {
            const fullName = nameEl.textContent?.trim() || '';
            
            // Skip if this is the company name
            if (fullName.toLowerCase() === companyName) return;
            
            // Skip if name is too short or looks like company name
            if (fullName.split(/\s+/).length < 2) return;
            if (fullName === fullName.toUpperCase() && fullName.length > 10) return;
            
            if (fullName && fullName.length > 3 && fullName.length < 100) {
              const nameParts = fullName.trim().split(/\s+/);
              if (nameParts.length >= 2) {
                // Try to find description
                const proseDiv = container.querySelector('.prose.max-w-full.whitespace-pre-line') as HTMLElement;
                const description = proseDiv?.textContent?.trim() || undefined;
                
                // Only add if description mentions founder
                if (description && description.toLowerCase().includes('founder')) {
                  seenFounders.add(linkedIn);
                  
                  data.founders.push({
                    firstName: nameParts[0],
                    lastName: nameParts.slice(1).join(' '),
                    linkedIn,
                    description,
                  });
                }
              }
            }
          }
        });
      }
      
      // Final deduplication pass - remove any remaining duplicates
      const uniqueFounders: typeof data.founders = [];
      const seenKeys = new Set<string>();
      
      for (const founder of data.founders) {
        const key = founder.linkedIn || `${founder.firstName} ${founder.lastName}`.toLowerCase();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueFounders.push(founder);
        }
      }
      
      data.founders = uniqueFounders;

      // ============================================
      // 2. EXTRACT WEBSITE
      // ============================================
      // Look for external website links - YC pages typically show the company website prominently
      const allLinks = Array.from(document.querySelectorAll('a[href^="http"]'));
      const excludedDomains = ['ycombinator.com', 'linkedin.com', 'twitter.com', 'x.com', 
                                'facebook.com', 'instagram.com', 'github.com', 'youtube.com'];
      
      for (const link of allLinks) {
        try {
          const href = (link as HTMLAnchorElement).href;
          if (!href) continue;
          
          // Skip excluded domains
          if (excludedDomains.some(domain => href.includes(domain))) continue;
          
          // Look for common TLDs
          if (href.match(/\.(com|io|ai|co|org|net|dev|app|tech)(\/|$)/i)) {
            // Prefer links that are visible and in main content (not nav/footer)
            const parent = link.closest('nav, footer, header');
            if (!parent) {
              data.website = href;
              break;
            }
          }
        } catch (linkError) {
          continue;
        }
      }

      // ============================================
      // 3. EXTRACT TEAM SIZE
      // ============================================
      const bodyText = document.body.innerText || '';
      const teamSizePatterns = [
        /team\s+size[:\s]+(\d+)/i,
        /(\d+)\s+employees/i,
        /team\s+of\s+(\d+)/i,
      ];
      
      for (const pattern of teamSizePatterns) {
        const match = bodyText.match(pattern);
        if (match && match[1]) {
          data.teamSize = match[1];
          break;
        }
      }

      // ============================================
      // 4. EXTRACT JOBS (from main page)
      // ============================================
      // Look for "Jobs" tab or section
      const jobsHeading = Array.from(document.querySelectorAll('h2, h3, button, [role="tab"]'))
        .find(el => {
          const text = el.textContent?.toLowerCase() || '';
          return text.includes('jobs') && !text.includes('guide');
        });
      
      if (jobsHeading) {
        // Find job listings near the heading
        const container = jobsHeading.closest('section, div, [role="tabpanel"]') || 
                         jobsHeading.parentElement;
        
        if (container) {
          // Look for job title patterns - typically in headings or links
          const jobElements = container.querySelectorAll('h3, h4, h5, a, div[class*="job"]');
          
          jobElements.forEach(jobEl => {
            const text = jobEl.textContent?.trim() || '';
            
            // Job titles are typically 5-80 characters, not navigation text
            if (text.length >= 5 && 
                text.length <= 80 &&
                !text.match(/^(view|apply|see|all|jobs?)$/i) &&
                !text.includes('View all') &&
                !text.includes('Apply Now') &&
                !text.includes('Jobs at')) {
              
              // Check if it looks like a job title (has common job words or is in a job container)
              const isJobTitle = /engineer|developer|designer|manager|director|lead|intern|analyst|scientist|specialist/i.test(text) ||
                                jobEl.closest('[class*="job"], [class*="position"], [class*="opening"]');
              
              if (isJobTitle) {
                // Extract location if present in the same element or nearby
                const parentText = jobEl.parentElement?.textContent || '';
                const locationMatch = parentText.match(/([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*),\s*(United States|US|USA|California|New York|Texas)/);
                const location = locationMatch ? locationMatch[0] : undefined;
                
                // Extract description from nearby paragraph
                const descEl = jobEl.parentElement?.querySelector('p');
                const description = descEl?.textContent?.trim() || '';
                
                data.jobPostings.push({
                  title: text,
                  description: description.substring(0, 500),
                  location: location,
                });
              }
            }
          });
        }
      }

      // ============================================
      // 5. EXTRACT LOCATION
      // ============================================
      const locationPatterns = [
        /location[:\s]+([A-Za-z\s,]+(?:,\s*[A-Za-z]+)?)/i,
        /based\s+in[:\s]+([A-Za-z\s,]+(?:,\s*[A-Za-z]+)?)/i,
        /headquarters[:\s]+([A-Za-z\s,]+(?:,\s*[A-Za-z]+)?)/i,
      ];
      
      for (const pattern of locationPatterns) {
        const match = bodyText.match(pattern);
        if (match && match[1]) {
          const loc = match[1].trim();
          // Filter out obviously wrong matches
          if (loc.length > 3 && loc.length < 100 && !loc.includes('http')) {
            data.location = loc;
            break;
          }
        }
      }

      // ============================================
      // 6. EXTRACT ONE-LINE SUMMARY / DESCRIPTION
      // ============================================
      // Try multiple strategies to find the company description
      
      // Strategy 1: Meta description
      const metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
      if (metaDesc?.content && metaDesc.content.length > 20) {
        data.oneLineSummary = metaDesc.content.trim();
      }
      
      // Strategy 2: First paragraph after h1 (company name)
      if (!data.oneLineSummary) {
        const h1 = document.querySelector('h1');
        if (h1) {
          let next = h1.nextElementSibling;
          while (next && !data.oneLineSummary) {
            if (next.tagName === 'P' || next.tagName === 'DIV') {
              const text = next.textContent?.trim() || '';
              if (text.length > 20 && text.length < 500) {
                data.oneLineSummary = text;
                break;
              }
            }
            next = next.nextElementSibling;
          }
        }
      }
      
      // Strategy 3: Look for description in main content area
      if (!data.oneLineSummary) {
        const mainContent = document.querySelector('main, [role="main"], article') || document.body;
        const paragraphs = mainContent.querySelectorAll('p');
        
        for (const p of Array.from(paragraphs)) {
          const text = p.textContent?.trim() || '';
          // Good description is usually 50-400 chars, not too short, not too long
          if (text.length >= 50 && text.length <= 400 && 
              !text.includes('Apply') && 
              !text.includes('View') &&
              !text.includes('LinkedIn')) {
            data.oneLineSummary = text;
            break;
          }
        }
      }

        return data;
      } catch (evalError) {
        console.error('   ❌ Error in page evaluation:', evalError);
        // Return empty data structure instead of throwing
        return {
          founders: [],
          website: '',
          teamSize: '',
          jobPostings: [],
          location: '',
          oneLineSummary: '',
        };
      }
    });

    // Check if we got valid data
    if (!pageData) {
      console.error(`   ❌ Page evaluation returned null`);
      return null;
    }

    // ============================================
    // 7. SCRAPE JOBS PAGE IF AVAILABLE
    // ============================================
    // Check if there's a jobs page link
    const jobsPageUrl = await page.evaluate(() => {
      const jobsLink = Array.from(document.querySelectorAll('a'))
        .find(link => {
          const href = (link as HTMLAnchorElement).href;
          const text = link.textContent?.toLowerCase() || '';
          return (href.includes('/jobs') || text.includes('view all jobs') || text.includes('jobs'));
        });
      return jobsLink ? (jobsLink as HTMLAnchorElement).href : null;
    });

    // If jobs page exists and we didn't find many jobs, scrape it
    if (jobsPageUrl && pageData.jobPostings.length < 3) {
      console.log(`   📋 Found jobs page, scraping: ${jobsPageUrl}`);
      try {
        await page.goto(jobsPageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const jobsPageData = await page.evaluate(() => {
          const jobs: Array<{ title: string; description: string; location?: string }> = [];
          
          // Look for "Jobs at [Company]" section
          const jobsSection = Array.from(document.querySelectorAll('h2, h3'))
            .find(el => el.textContent?.includes('Jobs at'));
          
          if (jobsSection) {
            const container = jobsSection.parentElement;
            // Find all job listings - they're typically in divs or list items
            const jobElements = container?.querySelectorAll('div, article, li') || [];
            
            jobElements.forEach(jobEl => {
              const text = jobEl.textContent?.trim() || '';
              
              // Look for job title pattern (typically a heading or strong text)
              const titleEl = jobEl.querySelector('h3, h4, h5, strong, a');
              const title = titleEl?.textContent?.trim() || '';
              
              // Look for location pattern
              const locationMatch = text.match(/([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*),\s*(United States|US|USA)/);
              const location = locationMatch ? locationMatch[0] : undefined;
              
              // Filter out non-job elements
              if (title && 
                  title.length > 5 && 
                  title.length < 100 &&
                  !title.includes('View all') &&
                  !title.includes('Apply Now') &&
                  !title.includes('Jobs at') &&
                  !title.includes('Why you should')) {
                
                // Extract description if available (usually in a paragraph)
                const descEl = jobEl.querySelector('p');
                const description = descEl?.textContent?.trim() || '';
                
                jobs.push({
                  title: title,
                  description: description.substring(0, 500),
                  location: location,
                });
              }
            });
          }
          
          return jobs;
        });
        
        // Merge jobs from jobs page (avoid duplicates)
        const existingTitles = new Set(pageData.jobPostings.map(j => j.title.toLowerCase()));
        jobsPageData.forEach(job => {
          if (!existingTitles.has(job.title.toLowerCase())) {
            pageData.jobPostings.push(job);
          }
        });
        
        console.log(`   ✅ Found ${jobsPageData.length} additional jobs from jobs page`);
      } catch (error) {
        console.warn(`   ⚠️  Could not scrape jobs page: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return pageData;
  } catch (error) {
    console.error(`   ❌ Error scraping YC page: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`   Stack trace: ${error.stack}`);
    }
    return null;
  }
}

/**
 * Get already processed company links from Supabase
 */
async function getAlreadyProcessedLinks(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('startups')
      .select('yc_link')
      .eq('data_source', 'yc')
      .not('yc_link', 'is', null);

    if (error) {
      console.warn('  ⚠️  Could not fetch already-processed companies:', error);
      return new Set();
    }

    const links = new Set<string>();
    data?.forEach((row: any) => {
      if (row.yc_link) {
        // Normalize URL for comparison (lowercase, remove trailing slash)
        const normalized = row.yc_link.toLowerCase().replace(/\/$/, '');
        links.add(normalized);
      }
    });

    return links;
  } catch (error) {
    console.warn('  ⚠️  Error fetching already-processed companies:', error);
    return new Set();
  }
}

/**
 * Store YC company data in Supabase
 */
async function storeYCCompanyInSupabase(company: YCCompany, pageData: YCPageData): Promise<boolean> {
  try {
    // Normalize company data to handle both CSV formats
    const normalized = normalizeCompanyData(company);

    const slug = extractCompanySlug(normalized.ycLink);
    if (!slug) {
      console.warn('  ⚠️  Could not extract slug from YC link');
      return false;
    }

    // Helper to convert empty strings to null
    const toNull = (value: string | undefined): string | null => {
      return value && value.trim() ? value.trim() : null;
    };

    // Format founder data - use existing schema (founder_names as comma-separated string)
    const founderNames = pageData.founders
      .map(f => `${f.firstName} ${f.lastName}`.trim())
      .filter(name => name.length > 0)
      .join(', ');

    const founderLinkedIns = pageData.founders
      .map(f => f.linkedIn)
      .filter(linkedin => linkedin.length > 0)
      .join(', ');

    // Combine founder descriptions
    const founderDescriptions = pageData.founders
      .map(f => f.description ? `${f.firstName} ${f.lastName}: ${f.description}` : null)
      .filter(Boolean)
      .join('\n\n');

    // Get primary founder for separate fields
    const firstFounder = pageData.founders[0] || { firstName: '', lastName: '', linkedIn: '', description: undefined };

    // Combine all job titles and descriptions with locations
    const jobOpenings = pageData.jobPostings.map(j => j.title).join(', ');
    const hiringRoles = pageData.jobPostings
      .map(j => {
        let role = j.title;
        if (j.location) role += ` (${j.location})`;
        if (j.description) role += `: ${j.description}`;
        return role;
      })
      .join('\n\n');

    const startupId = randomUUID();

    const { data, error } = await supabase
      .from('startups')
      .insert({
        id: startupId,
        name: normalized.companyName,
        description: toNull(normalized.description || pageData.oneLineSummary),
        location: toNull(normalized.location || pageData.location),
        website: toNull(pageData.website),
        industry: toNull(normalized.industry),
        business_type: toNull(normalized.businessType),
        batch: toNull(normalized.batch),
        yc_link: toNull(normalized.ycLink),
        company_logo: toNull(normalized.companyLogo),
        // Founder data (using existing schema)
        founder_names: toNull(founderNames), // Comma-separated names
        founder_linkedin: toNull(founderLinkedIns), // Comma-separated LinkedIn URLs
        founder_first_name: toNull(firstFounder.firstName), // Primary founder
        founder_last_name: toNull(firstFounder.lastName), // Primary founder
        // Store founder descriptions in founder_backgrounds if column exists
        founder_backgrounds: toNull(founderDescriptions),
        // Team and jobs
        team_size: toNull(pageData.teamSize),
        job_openings: toNull(jobOpenings),
        hiring_roles: toNull(hiringRoles),
        // Data source
        data_source: 'yc',
        needs_enrichment: true,
        enrichment_status: 'pending',
        // Funding data will be enriched separately
        funding_amount: null,
        round_type: null,
        date: null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Duplicate - already exists
        console.log('  ℹ️  Company already exists in database');
        return false;
      }
      throw error;
    }

    return true;
  } catch (error) {
    console.error(`  ❌ Error storing in Supabase: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Main scraping function
 */
async function scrapeYCCompanies() {
  console.log('🚀 Starting YC Company Scraping...\n');

  // Get command line arguments
  const args = process.argv.slice(2);
  const batchFilter = args.find(arg => arg.startsWith('--batch='))?.split('=')[1];

  // Test Supabase connection
  try {
    const { data, error } = await supabase.from('startups').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    console.log('✓ Connected to Supabase\n');
  } catch (error) {
    throw new Error(
      `Cannot connect to Supabase: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Get already processed companies
  console.log('🔍 Checking for already-processed companies...');
  const processedLinks = await getAlreadyProcessedLinks();
  console.log(`   Found ${processedLinks.size} already-processed companies\n`);

  // Load all companies from CSV files
  console.log('📂 Loading YC companies from CSV files...');
  const csvFiles = getAllYCCsvFiles();
  console.log(`   Found ${csvFiles.length} CSV file(s)`);

  let allCompanies: YCCompany[] = [];
  for (const csvFile of csvFiles) {
    const companies = loadCompaniesFromCSV(csvFile);
    console.log(`   Loaded ${companies.length} companies from ${csvFile.split(/[/\\]/).pop()}`);
    allCompanies = allCompanies.concat(companies);
  }

  // Filter by batch if specified
  if (batchFilter) {
    console.log(`\n🔍 Filtering for batch: ${batchFilter}`);
    allCompanies = allCompanies.filter(c => {
      const normalized = normalizeCompanyData(c);
      return normalized.batch.toLowerCase() === batchFilter.toLowerCase();
    });
  }

  console.log(`\n📊 Total companies to process: ${allCompanies.length}`);

  // Filter out already processed companies
  const newCompanies = allCompanies.filter(company => {
    const normalized = normalizeCompanyData(company);
    if (!normalized.ycLink) return false;
    // Normalize URL for comparison (lowercase, remove trailing slash)
    const normalizedLink = normalized.ycLink.toLowerCase().replace(/\/$/, '');
    return !processedLinks.has(normalizedLink);
  });

  console.log(`📋 New companies to scrape: ${newCompanies.length} (${allCompanies.length - newCompanies.length} already processed)\n`);

  if (newCompanies.length === 0) {
    console.log('✅ All companies already processed!');
    return;
  }

  // Launch Puppeteer browser
  console.log('🌐 Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  try {
    for (let i = 0; i < newCompanies.length; i++) {
      const company = newCompanies[i];
      const normalized = normalizeCompanyData(company);

      try {
        console.log(`\n[${i + 1}/${newCompanies.length}] 🏢 Processing: ${normalized.companyName}`);
        console.log(`   Batch: ${normalized.batch}`);
        console.log(`   URL: ${normalized.ycLink}`);

        // Scrape YC page
        const pageData = await scrapeYCCompanyPage(page, normalized.ycLink);

        if (!pageData) {
          console.log('  ⚠️  Failed to scrape page data, skipping...');
          errorCount++;
          continue;
        }

        // Log what we found
        console.log(`   Found ${pageData.founders.length} founder(s)`);
        if (pageData.founders.length > 0) {
          const foundersWithDescriptions = pageData.founders.filter(f => f.description).length;
          console.log(`   Founders with descriptions: ${foundersWithDescriptions}/${pageData.founders.length}`);
        }
        console.log(`   Website: ${pageData.website || 'Not found'}`);
        console.log(`   Team size: ${pageData.teamSize || 'Not found'}`);
        console.log(`   Job postings: ${pageData.jobPostings.length}`);

        // Store in Supabase
        const success = await storeYCCompanyInSupabase(company, pageData);

        if (success) {
          successCount++;
          console.log('   ✅ Successfully stored in Supabase');
        } else {
          skippedCount++;
        }

        // Rate limiting - wait between requests
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error processing ${normalized.companyName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    // Close browser
    try {
      await browser.close();
      console.log('\n🌐 Browser closed');
    } catch (closeError) {
      console.warn('⚠️  Browser cleanup warning:', closeError instanceof Error ? closeError.message : String(closeError));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Scraping Complete');
  console.log('='.repeat(60));
  console.log(`Total processed: ${newCompanies.length}`);
  console.log(`Successfully stored: ${successCount}`);
  console.log(`Skipped (duplicates): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log('='.repeat(60));
}

// Run the scraper
if (require.main === module) {
  scrapeYCCompanies()
    .then(() => {
      console.log('\n✅ Process completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Process failed:', error);
      process.exit(1);
    });
}

export { scrapeYCCompanies, extractCompanySlug, scrapeYCCompanyPage };
