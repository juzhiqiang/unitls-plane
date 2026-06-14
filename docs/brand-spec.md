# Utils Plane Brand Spec

## Logo Assets

- Primary mark SVG: `apps/web/public/brand/utils-plane-mark.svg`
- React mark component: `apps/web/src/components/brand/brand-mark.tsx`
- PWA icons: `apps/web/public/icons/icon-16.png`, `icon-32.png`, `icon-96.png`, `icon-180.png`, `icon-192.png`, `icon-512.png`

## Visual Direction

Apple-style system app icon: a dark glass rounded-square shell, a liquid route horizon, and a central north-star core.

## Palette

- Space black: `#0a0a0c`
- Glass charcoal: `#17181d`
- Route teal: `#5eead4`
- System silver: `#d4d4d8`
- Highlight white: `#f5f5f7`

## Usage

- Use `BrandMark` for in-app navigation, marketing header/footer, and auth entry points.
- Use the SVG source as the master asset when regenerating PWA PNG icons.
- Do not redraw the mark independently in feature pages.
