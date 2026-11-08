# UI primitives spike, 2026-11-08

Task 11 asks for a shared modal wrapper and the electorate combobox to be
spiked with React Aria Components, keeping the editorial design. This records
the decision for this pass: **do not add the dependency or migrate the
components yet**.

## What exists now

- `WinPercentDrawer.tsx` owns open/close, Escape, backdrop dismissal, body
  scroll lock and focus return to the header.
- `BottomSheet.tsx`, `ElectorateSearch.tsx` and `MapControls.tsx` own their
  keyboard navigation, safe-area and Leaflet stacking rules. Their behaviors are
  pinned by component tests.
- The design tokens and table/chip primitives are shared; there is no second
  primitive family.

## Why not adopt in this pass

1. Adding `react-aria-components` without migrating the drawer and search would
   create two overlapping primitive families, which the task explicitly
   forbids. Migrating both correctly is a UI change, not a dependency change.
2. The acceptance tests are real-browser: Tab/Shift-Tab containment, background
   inertness, nested Escape and scroll restoration, keyboard/touch search,
   macron matching and focus return at 360/390px in both themes. This worktree
   has no browser runner, and a headless component test would not exercise
   inertness or Leaflet stacking.
3. There is no measured reduction in app-owned behavior yet. The current
   wrappers are small and tested; replacing them on the strength of a library's
   API would trade known behavior for an unmeasured one.
4. The task permits a documented decision rather than a forced migration. The
   honest outcome is to record the spike's scope and the missing evidence.

## Next step (when a browser runner is available)

1. Branch from this worktree.
2. Add `react-aria-components` and wrap only the drawer's dialog, keeping its
   content and entry point.
3. Migrate the electorate combobox behind the same `ElectorateSearch` props.
4. Run the acceptance matrix at 360/390px and desktop in both themes; record
   deleted behavior code, wrapper code added, bundle and dependency delta.
5. Keep the library only if it removes app-owned focus/keyboard/dismissal/
   scroll machinery and meets the visual checks. Otherwise remove it and keep
   the current wrappers.

Release limitation: the current drawer/search remain as they are. No new
primitive family is shipped.
