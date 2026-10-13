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

Textures initially occupy a four-pixel lower band to avoid painting over glyphs, especially the white check/X symbols. This design choice needs rendered acceptance: the request asks for discernible dashed diagonal stripes across active elements, and a narrow band may prove too subtle. No universal colorblind-accessibility claim is made.

Unrelated audit notes: app viewport currently disables pinch zoom; existing tests deliberately protect that behavior. This feature does not expand into changing it. Statuses sharing a slope retain distinct explicit text; included/excluded marks also retain check/X and use different slopes.

Evidence is durable at .task-storage/striped-indicators/evidence outside the candidate checkout. Initial RED: three tests failed for missing default/texture/FAQ. A later RED caught benchmark-gradient replacement, repaired using layered images. Focused regression: 32 tests passed, zero skipped. Worker/changelog fingerprint RED and GREEN are recorded separately. Actual visual/type/overflow/focus/color-vision review, compatibility emulator, required CI, release receipts, deployment and live checks remain pending. Shared Mac runtime is reserved for PC10; no browser/emulator launched.
