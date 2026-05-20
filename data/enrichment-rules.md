# Venue Enrichment Rules

> Field definitions, types, enums, and dependency rules for the hospitality venue enrichment pipeline.
> Used as the AI system prompt during structured extraction.

## Field Schema (17 fields)

### Pre-filled from scraping pipeline (no AI needed)

| # | Field | Type | Source |
|---|-------|------|--------|
| 1 | `menu_found` | boolean | `classifyMenuSources()` — did we locate a readable menu |
| 1b | `menu_type` | string\|null | page, pdf, photo, platform — type of the best menu source. null if menu_found=false |
| 2 | `menu_url` | string\|null | URL of the best menu source. null if menu_found=false |
| 10 | `booking_system` | string\|null | `extractExternalPlatformLinks()` + iframe detection |
| 11 | `ordering_system` | string\|null | `extractExternalPlatformLinks()` — detected ordering platform |
| 12 | `has_online_ordering` | boolean | `extractExternalPlatformLinks()` |
| 16 | `has_gift_cards` | boolean | `extractExternalPlatformLinks()` |

### AI-extracted — menu dependent (REQUIRE menu_found=true)

| # | Field | Type | Allowed values | Rule |
|---|-------|------|----------------|------|
| 3 | `proteins_on_menu` | string[]\|null | beef, pork, chicken, lamb, fish, seafood, shellfish | Extract ONLY from menu content. null if menu_found=false |
| 4 | `dominant_protein` | string\|null | same enum as above | Single most featured protein. null if mixed/unclear or menu_found=false |
| 5 | `dominant_protein_main_dish` | string\|null | free text | Name of the main dish featuring the dominant protein. null if dominant_protein=null |
| 6 | `dominant_protein_main_dish_sellingprice` | number\|null | — | Price of that dish as listed on the menu. null if dominant_protein=null |
| 7 | `price_tier` | string\|null | budget, mid-range, premium, fine-dining | Derive ONLY from actual menu prices. null if menu_found=false |

### AI-extracted — general (always attempted, informed by menu when available)

| # | Field | Type | Allowed values | Rule |
|---|-------|------|----------------|------|
| 8 | `venue_category` | string | restaurant, bar, café, pub, fast-food, food-hall, hotel-restaurant, catering, bakery, nightclub | Fixed enum. Always required. Use ALL available data including menu content to determine category |
| 9 | `cuisine_style` | string\|null | free text | e.g. "modern Nordic", "Italian", "Thai street food". Use ALL available data including menu content. null if unclear |
| 11 | `has_online_ordering` | boolean | — | Pre-filled from scraping |
| 12 | `ordering_system` | string\|null | weorder, favrit, munu, orderx, gastroplanner, ninito | Pre-filled from scraping |
| 13 | `has_events_hosting` | boolean | — | True if venue mentions private dining, events, hire, selskap |
| 14 | `has_gift_cards` | boolean | — | Pre-filled from scraping |
| 15 | `is_chain` | boolean | — | True if venue has multiple locations |
| 16 | `chain_name` | string\|null | free text | Name of chain. null if is_chain=false |

### Data sources for `venue_category` and `cuisine_style`

These fields are NOT menu-dependent (they don't become null without a menu), but menu data **must** inform them when available:

| Menu type | How it informs fields 8-9 |
|-----------|--------------------------|
| **page** | Menu text (dish names, ingredients, descriptions) directly reveals cuisine style and venue type |
| **pdf** | Same as page — Firecrawl converts to text first |
| **platform** | Same as page — scraped platform menu text |
| **photo** | Menu images MUST be sent through AI vision first. The OCR'd menu content then informs cuisine/category decisions |
| **not found** | Determine from website copy only (about page, descriptions, homepage text) |

**Key rule**: When menu data exists (any type), it takes priority over marketing copy for determining `cuisine_style`. A venue may describe itself as "modern Nordic" but if the menu is 90% Italian dishes, `cuisine_style` = "Italian".

## Enum Definitions

### Protein enum
beef, pork, chicken, lamb, fish, seafood, shellfish

### Venue category enum
restaurant, bar, café, pub, fast-food, food-hall, hotel-restaurant, catering, bakery, nightclub

### Price tier enum
budget, mid-range, premium, fine-dining

### Booking system enum (pre-filled from scraping)
gastroplanner, dinnerbooking, sevenrooms, opentable, resy, resdiary, easytablebooking, tripleseat, null

### Ordering system enum (pre-filled from scraping)
weorder, favrit, munu, orderx, gastroplanner, ninito, null

## Menu Type Processing

The scraping pipeline classifies menu sources into types. Each type requires different processing before AI extraction:

| Menu type | Content | Processing |
|-----------|---------|------------|
| **page** | Text menu on venue website | Extract fields 3-7 directly from markdown text |
| **pdf** | PDF document linked from site | Firecrawl converts PDF → markdown text → extract fields 3-7 |
| **platform** | External ordering platform (weorder, favrit, etc.) | Extract fields 3-7 from scraped platform text |
| **photo** | Menu page with images only, no extractable text | Send image URLs to AI vision (Claude/Gemini) to read menu → then extract fields 3-7 |

**Photo menu pipeline**: When menu type is `photo`, the markdown contains image URLs (`![](url.jpg)`) but no food text. These images must be passed to a vision-capable model to OCR/read the menu content before structured extraction can happen.

## Dependency Rules

```
menu_found = false  →  menu_url = null
                        proteins_on_menu = null
                        dominant_protein = null
                        dominant_protein_main_dish = null
                        dominant_protein_main_dish_sellingprice = null
                        price_tier = null

dominant_protein = null →  dominant_protein_main_dish = null
                           dominant_protein_main_dish_sellingprice = null

is_chain = false  →  chain_name = null
```

## Markdown File Structure

Each scraped venue produces a single markdown file with this structure:

```
# Venue Name

Source: https://website.url
Scraped: DD MMM YYYY
Pages: N
City: CityName
Menu: found — type1 (/path1), type2 (/path2), pdf (filename.pdf)
Booking: system_name | not detected
Ordering: system_name | not detected
Gift cards: yes | not detected

---
## https://full-url-of-page-1

[page content as markdown]

---
## https://full-url-of-page-2

[page content as markdown]

---
## https://website.url/s/menu.pdf

[PDF content extracted as text — often dense, single-line, no formatting]

---
```

### Critical: Reading the full file

Pages are ordered by **enrichment priority**: menu pages and PDFs appear first, then about/concept, then events, then homepage, then everything else. However:

- **PDF sections** appear as `## https://...filename.pdf` headers. Their content is extracted text that is often **dense, single-line, with no paragraph breaks** — all dish names, descriptions, prices, and allergen info concatenated into one or two very long lines. You MUST parse this text carefully to find dishes and prices.
- **The file may have 10+ page sections**. You MUST read ALL sections, not just the first few. Menu data is often in PDF sections which may appear after several page sections.
- **The header `Menu:` line lists ALL classified menu sources**. If it says `pdf (HW_Meny.pdf)`, there WILL be a `## https://...HW_Meny.pdf` section somewhere in the body with extractable content.

### PDF text format

PDF-extracted text has a distinctive format — no line breaks between items. Example:
```
Shish Taouk (300g) 395,- Marinert kyllingfilet... Kofta (300g) 395,- Marinert lam og biff... Indrefilet (300g) 565,-
```

To parse: look for patterns like `dish name PRICE,-` or `dish name Kr. PRICE` within the dense text. Prices in Norwegian menus use `,-` suffix (e.g. `395,-`) or `kr` prefix/suffix.

### Price formats in Norwegian menus

- `395,-` — most common (number + comma + dash)
- `Kr. 238` — "Kr." prefix
- `395 kr` — "kr" suffix
- `395,- per person` — per-person pricing (sharing/tasting menus)
- `475 / 895,-` — dual pricing (e.g. 1 person / 2 persons)
- `2kr/g` — per-gram pricing (e.g. Tomahawk steak) → treat as variable, record as null

## Anti-Hallucination Rules

1. **No menu, no data**: If `menu_found` is false, ALL menu-dependent fields (3-7) MUST be null. Do NOT infer proteins, prices, or dishes from venue name, concept, location, or any other source.
2. **Enum strictness**: Only use values from the allowed enum lists. Do not invent new categories.
3. **Protein enum**: beef, pork, chicken, lamb, fish, seafood, shellfish — nothing else.
4. **Venue category enum**: restaurant, bar, café, pub, fast-food, food-hall, hotel-restaurant, catering, bakery, nightclub — nothing else.
5. **Price tier enum**: budget, mid-range, premium, fine-dining — nothing else.
6. **Booking system enum**: gastroplanner, dinnerbooking, sevenrooms, opentable, resy, resdiary, easytablebooking, tripleseat — nothing else. Pre-filled from scraping, AI must not override.
7. **Ordering system enum**: weorder, favrit, munu, orderx, gastroplanner, ninito — nothing else. Pre-filled from scraping, AI must not override.
8. **Prices must be literal**: `dominant_protein_main_dish_sellingprice` must be the exact number from the menu, not estimated or averaged.
9. **Dish name must be literal**: `dominant_protein_main_dish` must be the exact dish name as written on the menu.
10. **Chain evidence required**: `is_chain` = true only if the scraped content explicitly mentions multiple locations. Do not infer from brand name alone.
11. **Multi-location menu disambiguation**: When a venue header includes `City: <name>` and the scraped content contains menus for multiple locations (e.g. "Meny Oslo" and "Meny Lillestrøm", or separate PDF links per city), extract fields 3-7 ONLY from the menu matching the venue's city. Ignore menus for other locations entirely. If the city-specific menu cannot be identified, treat as menu_found=false for fields 3-7.

## Extraction Completeness Rules

12. **Read ALL page sections**: The markdown file contains multiple `## URL` sections. You MUST read every section, especially PDF sections (URLs ending in `.pdf`) which often contain the richest menu data. Do not stop reading after the first few pages.
13. **Parse dense PDF text**: PDF-extracted text has no formatting — dishes and prices are concatenated in long lines. Scan for price patterns (`\d{2,4},-` or `Kr\. \d+`) to locate menu items within the dense text.
14. **Menu header is the index**: The `Menu:` header line lists all classified sources. If a PDF is listed there, its content exists in the file body — find and read it.
15. **All-you-can-eat / experience pricing**: Some venues (e.g. Brazilian steakhouses) have per-person experience pricing instead of per-dish pricing. If individual dish prices don't exist but experience/set pricing does (e.g. "645,- per person"), record `dominant_protein_main_dish` as the signature dish name and `dominant_protein_main_dish_sellingprice` as the experience price. Set `price_tier` based on the per-person price.
16. **Set menu / tasting menu pricing**: When a venue offers only set menus (e.g. "5 retter 995kr", "Smalhans 695kr"), and individual dishes are not priced, set `dominant_protein_main_dish_sellingprice` to null (no per-dish price). Set `price_tier` based on the per-person set price. Proteins can still be extracted if specific dishes are named in the set menu description.
17. **Drinks-only menus**: If the only menu content is beverages (wine, beer, cocktails, snacks like nuts/chips/olives), do NOT extract proteins. A drinks-only menu does not count as a food menu for fields 3-7. Set menu-dependent fields to null.
18. **Photo menus vs readable menus**: The `Menu:` header classifies sources as `page`, `pdf`, `photo`, or `platform`. If ALL sources are `photo` type (images without text), menu-dependent fields must be null. But if ANY source is `page` or `pdf` with readable text content in the body, extract from that text regardless of the photo sources.
