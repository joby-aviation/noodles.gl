# Theatre.js Removal Specification

## Executive Summary

This specification documents the complete removal of Theatre.js from Noodles.gl and its replacement with a native timeline system. Theatre.js currently provides keyframe animation, timeline UI, and reactive field bindings. The replacement must preserve the features users value most while giving us full control over the implementation.

**Estimated effort:** 4-6 weeks for a senior engineer
**Risk level:** Medium-High (significant UI work, interpolation math, migration)
**Decision:** Full replacement (Option A) - build native timeline from scratch

## Document Structure

| Document | Purpose |
|----------|---------|
| [requirements.md](./requirements.md) | What we must preserve and achieve |
| [architecture.md](./architecture.md) | System design, data structures, state model |
| [ui-specification.md](./ui-specification.md) | Detailed UI feature requirements |
| [implementation-plan.md](./implementation-plan.md) | Component breakdown, phases, timeline |
| [verification.md](./verification.md) | Testing, parity verification, benchmarks |
| [research-findings.md](./research-findings.md) | Theatre.js analysis and integration points |

## Background

Theatre.js has been the animation backbone of Noodles since early development. It provides:
- Keyframe-based animation with bezier interpolation
- A polished Studio UI with timeline, curve editor, and property panels
- A reactive state system (Dataverse) for value propagation
- Two-way binding between operator fields and animation tracks

However, Theatre.js also presents challenges:
- Shadow DOM rendering makes customization difficult (CSS injection hacks)
- Update dependencies and breaking changes outside our control
- Complex integration layer required (`theatre-bindings.ts`)
- Opaque state management that's hard to debug

## Goals

1. **Feature parity**: Match or exceed Theatre.js Studio's functionality
2. **Visual polish**: Timeline UI must feel equally professional and responsive
3. **Performance**: 60fps scrubbing, <16ms latency on all interactions
4. **Simplicity**: Cleaner data format, easier debugging, full control
5. **Extensibility**: Enable features Theatre.js doesn't support

## Non-Goals

- Theatre.js r3f extension (not used in Noodles)
- Theatre.js collaborative editing features (not used)
- Maintaining Theatre.js as a fallback permanently (feature flag for development only)

## Key Decisions

### Why full replacement over partial replacement?

Theatre.js integration is deep (~1,100 lines across 7 files). The data model, state management, and UI are tightly coupled. Keeping Theatre.js for data while replacing UI creates complexity without reducing dependency.

### Why not just wrap Theatre.js?

Current approach already wraps Theatre.js with significant CSS injection hacks. These are fragile and break across Theatre.js versions. A clean implementation is more maintainable long-term.

## Success Criteria

1. All existing example projects load and animate correctly after migration
2. Video rendering produces frame-identical output
3. Internal team can work with native timeline for 1 week without major friction
4. No Theatre.js packages in `package.json` after completion
5. Performance benchmarks match or exceed Theatre.js baseline

## Related Documents

- [AGENTS.md](../../../AGENTS.md) - Codebase overview and architecture
- [architecture.md](../../architecture.md) - System architecture documentation
- [testing-guide.md](../../testing-guide.md) - Testing strategy and guidelines
