# Default Values Found in Database

## Analysis Results

Using Supabase MCP tools, we analyzed the database and found the following default/placeholder values:

### Website Defaults

**140+ websites match the "name.com" pattern** - these are auto-generated from company names instead of actual website URLs:

Examples found:
- `F2` → `f2.com`
- `Pond` → `pond.com`
- `Outrove` → `outrove.com`
- `Floot` → `floot.com`
- `Modelence` → `modelence.com`
- `Keystone` → `keystone.ai`
- `Interfere` → `interfere.dev`
- `stagewise` → `stagewise.io`

**Pattern detected**: Websites that exactly match the normalized company name + common TLD (.com, .ai, .io, .dev, .app, .co, .org) are likely defaults.

### Other Default Values Found

From SQL analysis:
- **153 startups** have `$1.5M` funding amount (placeholder)
- **73 startups** have `Team` as founder names (placeholder)
- **73 startups** have `hello@...` pattern emails (placeholder)
- **113 websites** are simple domains without protocols (may be defaults)

## Solution Implemented

### 1. Website Pattern Detection

Added `isDefaultWebsitePattern()` function that:
- Normalizes company name (removes spaces, hyphens, underscores)
- Checks if website domain exactly matches normalized name + TLD
- Detects defaults like: `companyname.com`, `companyname.ai`, etc.

### 2. Updated Normalization Script

The `normalize_placeholder_values.ts` script now:
- ✅ Detects websites that match company name pattern
- ✅ Detects `$1.5M` funding amounts
- ✅ Detects `Team` founder names
- ✅ Detects `hello@...` emails
- ✅ Sets all placeholders to NULL

### 3. Normalization Process

**Before normalization:**
```
name: "F2"
website: "f2.com"  ← Default pattern
funding_amount: "$1.5M"  ← Placeholder
founder_names: "Team"  ← Placeholder
```

**After normalization:**
```
name: "F2"
website: NULL  ← Set to NULL so enrichment can find real website
funding_amount: NULL  ← Set to NULL so enrichment can find real amount
founder_names: NULL  ← Set to NULL so enrichment can find real names
```

## Usage

```bash
# 1. Preview what will be normalized
npm run normalize:placeholders

# 2. Normalize all placeholder values to NULL
npm run normalize:placeholders:auto

# 3. Mark startups for re-enrichment
npm run enrich:mark:auto

# 4. Process enrichment
npm run enrich-startups 50
```

## Detection Logic

### Website Default Pattern

A website is considered a default if:
1. Domain exactly matches normalized company name + common TLD
   - `normalizedName.com`
   - `normalizedName.ai`
   - `normalizedName.io`
   - etc.

2. Normalization removes:
   - Spaces: "DeepAware AI" → "deepawareai"
   - Hyphens: "b-12" → "b12"
   - Underscores: "mcp_use" → "mcpuse"

### Examples

| Company Name | Website | Is Default? | Reason |
|-------------|---------|-------------|---------|
| `F2` | `f2.com` | ✅ Yes | Exact match |
| `Pond` | `pond.com` | ✅ Yes | Exact match |
| `Keystone` | `keystone.ai` | ✅ Yes | Exact match with different TLD |
| `Interfere` | `interfere.dev` | ✅ Yes | Exact match with different TLD |
| `Alara` | `alaradental.com` | ❌ No | Has suffix "dental" - likely real |
| `Avent` | `aventindustrial.com` | ❌ No | Has suffix "industrial" - likely real |

## Impact

After normalization:
- ~140+ websites will be set to NULL (can be re-enriched)
- 153 funding amounts will be set to NULL
- 73 founder names will be set to NULL
- 73 founder emails will be set to NULL

This ensures enrichment will search for and find the real values instead of keeping placeholders.


