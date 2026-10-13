# Colorblind state audit — optional patterned indicators

Base: 4be6e16df3b922e357ccac317b811e376334d9ad. Source audit only until the coordinated runtime window is allocated. Simulations will be aids, not proof of universal accessibility.

The effective palette comes from landscape.css after the inline index styles. Selected context chips use --chain-deep (#96d6b2 day, #8dcbb0 night) with --action-ink (#243b40). Unselected controls use the white/day or #3d566b/night --surface. The feature retains these tokens. Default is false; strict boolean normalization backfills old data. Changes use the existing board settings, save/Undo and sync machinery, with no new persistence protocol.

| Actual surface | Existing noncolor cue | Opt-in coverage |
| --- | --- | --- |
| Context availability, Settings and main panel | Check/X and accessible included/excluded names | Opposite diagonal stripe slopes on the colored marks |
| Add context draft, All Tasks filters, Edit/Bulk context labels | Pressed state or native checked checkbox; captions | Selected chip texture; unselected remains plain |
| All/Eligible/Ineligible and task tag filters | Captions and pressed state | Active filter texture |
| Task selection | Selected caption and pressed state, native focus | Selection texture; unselected remains plain |
| Add changed draft | Existing Add caption; green change cue | Changed-draft texture; no validity/save claim |
| Settings scene time/location and scene-time dialog choices | Status sentences and pressed selections | Texture; unset/locked direction differs from set/live |
| Scanner benchmark/candidate | Separate positions, task titles and decision controls | Texture retains benchmark gradient and candidate fill |
| Due statuses | Date-relative captions, today/overdue/tomorrow classes | Texture retains color and caption; text differentiates statuses |
| Sync status | Local/saved/syncing/error captions, error icon | Texture beneath caption, semantics retained |
| Decision buttons, task history, skipped/resting/postponed, dependency blockers | Explicit verbs/status/date words or icons | No added texture: colors do not alone indicate a selected state |
| Native checkboxes/radios/selects and settings Apply | Native checked/selected state and labels | Preserve native controls |
| Rank/progress graphics | Rank/percentage/pass labels and geometric lengths | Preserve continuous quantitative graphics; no categorical state texture |
| Landscape scenery | Decoration | Out of scope |

The first source review rejected the universal four-pixel edge band and identified invisible white-on-white sync textures. Selected control fills now use repeated sixteen-pixel SVG tiles with genuinely dashed white diagonals across the field; excluded/unset controls use the opposite slope. The small white check/X glyphs, dark-theme candidate title and tomorrow badge retain a four-pixel edge cue to avoid obscuring existing light ink. Sync uses a semantic-ink diagonal edge cue, visible against its surface in either theme. Actual visibility and typography remain unverified until the coordinated browser window. No universal colorblind-accessibility claim is made.

Unrelated audit notes: app viewport currently disables pinch zoom; existing tests deliberately protect that behavior. This feature does not expand into changing it. Statuses sharing a slope retain distinct explicit text; included/excluded marks also retain check/X and use different slopes.

Evidence is durable at .task-storage/striped-indicators/evidence outside the candidate checkout. Initial RED: three tests failed for missing default/texture/FAQ. A later RED caught benchmark-gradient replacement, repaired using layered images. Focused regression before texture repair: 36 tests passed, zero skipped. Reviewer repair RED and light-label-protection RED are recorded separately; updated source checks remain pending final runtime acceptance. Worker/changelog fingerprint RED and GREEN are recorded separately. Actual visual/type/overflow/focus/color-vision review, compatibility emulator, required CI, release receipts, deployment and live checks remain pending. Shared Mac runtime is reserved for PC10; no browser/emulator launched.

Reconciled the separately released context fix at cb64ed3d44d46d120acc623649f863d73cf8d29a. Its native-checkbox fallback and unavailable-reference preservation remain intact. Observed its selector-isolation contract fail on the feature texture group, then observed a new patterned selector-fallback RED before isolating editor texture in its own supports rule. Retained all released tests unchanged; final integration/source checks are recorded separately. The temporary conflict-resolution syntax error is recorded as integration failure, not functional RED. No browser launched during reconciliation.

First actual rendered qualification of f80c208 completed14cases and simulations; independent review requested changes. Selected rank stripes were invisible on the transparent day slot and crossed light night labels; selected motion captions lost contrast; edge images squashed16px tiles into4px and were too weak. New contemporaneous RED preceded the fixes: selected rank uses shared green fill and an opaque backing retaining its existing label ink; selected secondary descriptions adopt established action ink; square tiles are clipped inside a decorative noninteractive edge band. The earlier blanket no-color-change assertion now allows only these exact contrast rules, with dedicated assertions and numeric4.5:1 contracts; all other paint/motion protections remain. Earlier small-edge scale assertions are strengthened to full-size tile clipping. Missing scrolled dialog captures and resolved-font evidence are fixture gaps, still pending actual requalification. Browser/server physical handback23:12:29UTC; compatibility deferred, no publication.
