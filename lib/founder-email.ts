function normalizeFirstName(firstName?: string | null): string | null {
  if (!firstName) return null;
  const local = firstName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return local || null;
}

function extractDomainFromWebsite(website?: string | null): string | null {
  if (!website) return null;
  let url = website.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  try {
    const host = new URL(url).hostname.toLowerCase();
    // Strip leading "www." if present
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/**
 * Returns a founder email to use and whether it was guessed.
 * If a real founder_emails value exists, it is preferred.
 * Otherwise we guess firstName@domain using founder_first_name + website.
 */
export function guessFounderEmailFromStartup(startup: {
  founder_first_name?: string | null;
  founder_emails?: string | null;
  website?: string | null;
}) {
  // If a real email already exists, use it as-is.
  if (startup.founder_emails?.trim()) {
    return {
      email: startup.founder_emails.trim(),
      isGuessed: false,
    };
  }

  const local = normalizeFirstName(startup.founder_first_name);
  const domain = extractDomainFromWebsite(startup.website);

  if (!local || !domain) {
    return {
      email: null,
      isGuessed: false,
    };
  }

  return {
    email: `${local}@${domain}`,
    isGuessed: true,
  };
}


