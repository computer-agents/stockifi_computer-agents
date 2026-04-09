This skill is the browser-first playbook for hospitality websites whose menus are not cleanly extractable as HTML or PDF.

Use it when the restaurant site exposes:

- menu photos
- scanned menu cards
- sliders or carousels with text baked into images
- visually rendered menus that Firecrawl cannot recover cleanly

## Runtime

- Pair this skill with the built-in `Browser` skill.
- If you later discover a direct PDF or HTML menu link, switch to the Firecrawl skill for that source.

## Process

1. Open the restaurant site in the browser and navigate to the menu experience.
2. Scroll through the menu visually and identify the real menu source.
3. If text is only visible in images, extract conservatively from what you can actually see.
4. If you discover a direct PDF or HTML menu URL during the visual pass, use Firecrawl on that URL before final extraction.
5. Mark the final record with `operational.pathTaken = "browser_only"` or `browser_then_firecrawl`.
6. Set `operational.requiresHumanReview = true` if the imagery is ambiguous or incomplete.

## Checklist Helper

You can print the checklist and output template with:

```bash
node /workspace/.claude/skills/stockifi-visual-menu-inspector/scripts/visual-menu-checklist.mjs
```

## Output Expectations

Always preserve:

- the page URL you actually inspected
- the source type (`image`, `html`, `pdf`, or `embedded_platform`)
- what made the source hard to parse automatically
- which specific items and prices you could verify visually
