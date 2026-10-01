# FocusGuard — Low-Fidelity Wireframes (Phase 0)

Purpose: agree on layout and content before building Phase 1 screens. Visual design follows the
tokens in `apps/web/src/styles/index.css` (light and dark), shadcn/ui-style components, a 4/8 px
spacing scale and WCAG 2.2 AA contrast.

Legend: `[Button]` · `( )` radio · `[x]` checkbox · `▓▓░░` progress · `{…}` dynamic value.

---

## 1. App shell (every authenticated page)

```text
┌──────────────┬──────────────────────────────────────────────────────────────────┐
│ ◉ FocusGuard │                                          [⌘K]  [◐ theme]  (JD) │
│              ├──────────────────────────────────────────────────────────────────┤
│ ▣ Overview   │                                                                  │
│ ☑ Tasks      │   {page content, max-width 1100px}                               │
│ ⏱ Sessions   │                                                                  │
│ ▥ Analytics  │                                                                  │
│ 🌐 Domains   │                                                                  │
│ ⚙ Settings   │                                                                  │
│              │                                                                  │
│ ┌──────────┐ │                                                                  │
│ │Extension │ │                                                                  │
│ │● Connected│ │                                                                 │
│ └──────────┘ │                                                                  │
└──────────────┴──────────────────────────────────────────────────────────────────┘
Mobile (< 768px): sidebar hidden → bottom tab bar with the same 6 icons.
```

## 2. Overview (dashboard)

```text
Overview                                                       [+ New session (N)]
┌─ Current session ───────────────────────────────┐ ┌─ Today ──────────────────────┐
│  ◯ 42:17 remaining   ▓▓▓▓▓▓▓▓░░░░ 65%            │ │ Focus time      1h 35m       │
│  3:00 PM – 5:00 PM · Work block 2 of 3           │ │ Sessions done   2            │
│  [x] LeetCode problem 1   [ ] LeetCode 2         │ │ Blocked tries   4            │
│  Blocked attempts so far: 4                      │ │ Tasks           3/5          │
│                         [Extend +15] [End early] │ └──────────────────────────────┘
└──────────────────────────────────────────────────┘
┌─ Last 7 days focus (bar) ─────────────┐ ┌─ AI insights ──────────────────────────┐
│ ▂ ▅ ▇ ▃ ▆ ▇ ▅   [view as table]      │ │ Insights unlock after your first        │
└───────────────────────────────────────┘ │ sessions.  (Phase 2 fills this)         │
┌─ Recent activity ─────────────────────┐ └─────────────────────────────────────────┘
│ 15:42 leetcode.com        ● Planned   │ ┌─ Recent sessions ──────────────────────┐
│ 15:38 youtube.com         ● Uncertain │ │ Today 13:00–14:00  ✓ Completed  92% ›  │
│ 15:31 instagram.com       ■ Blocked   │ │ Yest. 21:00–22:30  ✗ Ended early 61% › │
└───────────────────────────────────────┘ └─────────────────────────────────────────┘
Empty state (no sessions yet): illustration + "Start your first focus session" [Start].
```

## 3. Session builder (create / schedule)

```text
New focus session
  When      ( ) Start now   ( ) Start at [Oct 2, 2026 ▾] [15:00 ▾]
  Duration  [25] [45] [60] [90] [custom: __ min]          ends at 15:45
  Tasks     [search or create task…]  ☑ Solve 3 LeetCode  ☑ Study ML topic
  Relevant  (leetcode.com ×) (github.com ×) (claude.ai ×) [+ add domain]
  Blocked   (instagram.com ×) (reddit.com ×) (netflix.com ×) [+ add] [Presets ▾]
            ⚠ validation: "reddit.com is in both lists"
  [ ] Keep blocking during breaks
                                               [Cancel]  [Start session]
```

## 4. Active session (full page)

```text
          ◯◯◯◯◯ big countdown 42:17 ◯◯◯◯◯
          3:00 PM – 5:00 PM · ends 5:00 PM
  Tasks: [x] … [ ] …            Blocked: instagram.com, reddit.com
  Live: blocked attempts 4 · switches 11
                      [Extend ▾]   [End early…]  → confirm dialog with reason
```

## 5. Session report

```text
Session report · Oct 2, 3:00–5:00 PM · ✓ Completed
┌ Summary ──────────────────────────────────────────────────────────────────────┐
│ Planned 120m │ Productive 95m │ Unplanned relevant 10m │ Distraction 15m       │
│ Uncertain 0m │ Outside browser 0m │ Blocked attempts 4 │ Switches 12 │ Tasks 80% │
└────────────────────────────────────────────────────────────────────────────────┘
Timeline  |██████▓▓▓██░░████████▒▒███|   ■ blocked-attempt markers ▲
          planned  relevant  distraction  uncertain  outside
Actual activity
  leetcode.com   58m  ● Planned
  youtube.com    21m  ● Unplanned relevant (estimated · "matches current task")  [Wrong label?]
  github.com      9m  ● Planned
Tasks  [x] … [ ] …  (tick remaining tasks → numbers recompute)
AI insight (Phase 2) · ML predictions (Phase 6) · Network (Phase 5)
```

## 6. Analytics

```text
Analytics          Range [Last 7 days ▾]   Granularity (Day) (Week)
┌ Focus time (bar) ───────────┐ ┌ Label breakdown (stacked) ────────────────────┐
└─────────────────────────────┘ └───────────────────────────────────────────────┘
┌ Completion rate  87% ↗ ─┐ ┌ Avg session 46m ─┐ ┌ Blocked attempts 23 ─┐
┌ Most visited domains ───────┐ ┌ Most distracting domains ──────────────────────┐
┌ Productive hours heatmap (weekday × hour) ──────────────────────────────────────┐
Every chart: [view as table].
```

## 7. Domains

```text
Domains
  Always block      (instagram.com ×) (reddit.com ×)        [+ add]  Presets: [Social] [Streaming] [News] [Shopping]
  Always relevant   (github.com ×) (stackoverflow.com ×)     [+ add]
  Never track       (mybank.com ×)                            [+ add]
```

## 8. Settings

```text
Settings   [Account] [Privacy] [Devices]
Account:  Name [____]  Time zone [Asia/Kolkata ▾]  [Change password]  [Delete account…]
Privacy:  [x] Track browser activity during sessions
          [ ] Collect page titles for context-aware classification (opt-in)
          Data we collect / never collect …   [Delete history ▾]
Devices:  Chrome on Windows · extension · last seen 2m ago   [Revoke]
          [Connect extension]  → shows pairing code ABCD-1234 (expires 2:00)
```

## 9. Onboarding

```text
Step 1 Install the extension → Step 2 Pair (auto via dashboard, or type code) → Step 3 First session
```

## 10. Chrome extension — floating widget states

```text
Hidden:     (no active session, or widget disabled)

Collapsed:  page edge →  ┌──┐      32×32 rounded square, logo + thin progress ring
                         │◉ │      tinted during break blocks
                         └──┘
Expanded:   page edge →  ┌──────────┐
                         │  42:17   │   remaining time ONLY; click to collapse
                         └──────────┘
Ended:      "Session complete ✓" for 5 s, then hidden.
Fallback:   toolbar badge "42m" on chrome:// and other pages where scripts can't run.
```

## 11. Blocked page (`blocked.html`)

```text
            ◉
   instagram.com is blocked until 5:00 PM
            42 min left in your session
   Current tasks: • Solve LeetCode — Binary Search
                 [Back to work]
   (no unblock button · "End session" link opens the dashboard with friction)
```
