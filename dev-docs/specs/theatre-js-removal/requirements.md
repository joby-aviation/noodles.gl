# Requirements Document

## Introduction

This document specifies the requirements for removing Theatre.js from Noodles.gl and replacing it with a native timeline system. The requirements are prioritized as P0 (must have), P1 (should have), and P2 (nice to have).

## Requirements

### Requirement 1: Keyframe Animation System (P0)

**User Story:** As a visualization creator, I want to animate properties over time using keyframes, so that I can create dynamic presentations and videos.

#### Acceptance Criteria

1. WHEN a keyframe is created THEN the system SHALL store the value, time position, and interpolation settings
2. WHEN playback reaches a position between keyframes THEN the system SHALL interpolate values using the specified easing curve
3. WHEN the interpolation type is "bezier" THEN the system SHALL use cubic bezier curves with user-adjustable handles
4. WHEN the interpolation type is "hold" THEN the system SHALL maintain the previous keyframe's value until the next keyframe
5. WHEN multiple properties are animated THEN each property SHALL have its own independent track and keyframes

### Requirement 2: Timeline UI with Playhead (P0)

**User Story:** As a visualization creator, I want a visual timeline with a draggable playhead, so that I can scrub through my animation and see the current state at any point in time.

#### Acceptance Criteria

1. WHEN the timeline is displayed THEN it SHALL show a time ruler with appropriate tick marks based on zoom level
2. WHEN the user clicks on the timeline ruler THEN the playhead SHALL jump to that position
3. WHEN the user drags the playhead THEN the visualization SHALL update in real-time at 60fps
4. WHEN the timeline is zoomed THEN the zoom SHALL center on the cursor position
5. WHEN keyframes exist THEN they SHALL be displayed as diamonds on their respective tracks

### Requirement 3: Two-Way Field Binding (P0)

**User Story:** As a visualization creator, I want changes in the timeline to update the visualization and vice versa, so that I can work fluidly between the timeline and property panels.

#### Acceptance Criteria

1. WHEN a keyframe value changes in the timeline THEN the corresponding operator field SHALL update immediately
2. WHEN an operator field value changes THEN the timeline SHALL update to reflect the new value
3. WHEN both timeline and field are being edited simultaneously THEN the system SHALL prevent infinite update loops
4. WHEN an operator is locked THEN field-to-timeline binding SHALL be disabled for that operator

### Requirement 4: Project Serialization (P0)

**User Story:** As a visualization creator, I want my keyframe animations to be saved and loaded with my project, so that I don't lose my work.

#### Acceptance Criteria

1. WHEN a project is saved THEN all keyframe data SHALL be serialized to the project JSON file
2. WHEN a project with Theatre.js timeline format is loaded THEN it SHALL be automatically migrated to the new native format
3. WHEN a project is loaded THEN all keyframe animations SHALL play back identically to when they were saved
4. WHEN migration fails THEN the system SHALL provide a clear error message and not corrupt the original file

### Requirement 5: Video Rendering (P0)

**User Story:** As a visualization creator, I want to export my animation as a video, so that I can share it with others.

#### Acceptance Criteria

1. WHEN video rendering starts THEN the playhead position SHALL be controllable frame-by-frame
2. WHEN a frame is rendered THEN all animated properties SHALL reflect the exact interpolated values at that time
3. WHEN video rendering completes THEN the output SHALL be frame-identical to previous Theatre.js renders

### Requirement 6: Bezier Curve Editor (P1)

**User Story:** As a visualization creator, I want to visually edit the easing curves between keyframes, so that I can fine-tune my animations with precision.

#### Acceptance Criteria

1. WHEN the curve editor opens THEN it SHALL display the bezier curve between selected keyframes
2. WHEN the user drags a bezier handle THEN the curve SHALL update in real-time
3. WHEN an easing preset is selected THEN the curve SHALL update to match the preset
4. WHEN handles are set to "aligned" mode THEN moving one handle SHALL mirror the other
5. WHEN the curve is edited THEN the animation preview SHALL update immediately

### Requirement 7: Scrubbable Number Inputs (P1)

**User Story:** As a visualization creator, I want to drag on number inputs to change their values smoothly, so that I can quickly dial in the right values.

#### Acceptance Criteria

1. WHEN the user drags horizontally on a number input THEN the value SHALL change proportionally
2. WHEN the Shift key is held during drag THEN the sensitivity SHALL decrease by 10x for fine control
3. WHEN the Alt/Option key is held during drag THEN the sensitivity SHALL increase by 10x for coarse control
4. WHEN the user double-clicks a number input THEN it SHALL enter text editing mode
5. WHEN a property has keyframes THEN the input SHALL display a keyframe indicator icon

### Requirement 8: Easing Presets Library (P1)

**User Story:** As a visualization creator, I want access to standard easing presets, so that I can quickly apply professional-looking animations.

#### Acceptance Criteria

1. WHEN the preset library opens THEN it SHALL display visual thumbnails of each easing curve
2. WHEN a preset is clicked THEN it SHALL be applied to the selected keyframe(s)
3. WHEN the user searches THEN the list SHALL filter by preset name
4. WHEN the standard presets exist THEN they SHALL include: Linear, Ease In, Ease Out, Ease In-Out, Quad, Cubic, Quart, Quint, Expo, Back, Elastic, Bounce variations

### Requirement 9: Undo/Redo for Timeline Operations (P1)

**User Story:** As a visualization creator, I want to undo and redo timeline changes, so that I can experiment without fear of losing work.

#### Acceptance Criteria

1. WHEN a keyframe is added THEN the operation SHALL be undoable
2. WHEN a keyframe is deleted THEN the operation SHALL be undoable
3. WHEN a keyframe is moved THEN the operation SHALL be undoable
4. WHEN bezier handles are adjusted THEN the operation SHALL be undoable
5. WHEN Ctrl/Cmd+Z is pressed THEN the most recent timeline operation SHALL be undone

### Requirement 10: Three-Tier State Model (P1)

**User Story:** As a visualization creator, I want my playback position to reset on reload but my UI preferences to persist, so that I have a consistent experience.

#### Acceptance Criteria

1. WHEN a project is saved THEN only keyframe data (historic state) SHALL be persisted
2. WHEN a project is loaded THEN the playhead position SHALL start at 0 (ephemeral state resets)
3. WHEN the user adjusts timeline zoom THEN that preference SHALL persist across sessions (ahistorical state)
4. WHEN the user closes and reopens the app THEN their timeline preferences SHALL be restored

### Requirement 11: Multi-Keyframe Selection (P2)

**User Story:** As a visualization creator, I want to select and manipulate multiple keyframes at once, so that I can make bulk edits efficiently.

#### Acceptance Criteria

1. WHEN the user shift-clicks keyframes THEN they SHALL be added to the selection
2. WHEN the user drags a selection box THEN all keyframes within SHALL be selected
3. WHEN multiple keyframes are selected THEN moving one SHALL move all proportionally
4. WHEN multiple keyframes are selected THEN deleting SHALL remove all of them
5. WHEN Ctrl/Cmd+A is pressed THEN all keyframes in the selected track SHALL be selected

### Requirement 12: Copy/Paste Keyframes (P2)

**User Story:** As a visualization creator, I want to copy and paste keyframes, so that I can reuse animations across properties and projects.

#### Acceptance Criteria

1. WHEN keyframes are copied THEN their values, positions, and easing settings SHALL be stored
2. WHEN keyframes are pasted THEN they SHALL be inserted at the current playhead position
3. WHEN keyframes are pasted to a different property THEN compatible values SHALL be converted
4. WHEN Ctrl/Cmd+C is pressed THEN selected keyframes SHALL be copied
5. WHEN Ctrl/Cmd+V is pressed THEN copied keyframes SHALL be pasted

### Requirement 13: Keyboard Shortcuts (P2)

**User Story:** As a visualization creator, I want keyboard shortcuts for common operations, so that I can work efficiently.

#### Acceptance Criteria

1. WHEN Space is pressed THEN playback SHALL toggle between play and pause
2. WHEN Left/Right Arrow is pressed THEN the playhead SHALL step one frame backward/forward
3. WHEN K is pressed THEN a keyframe SHALL be added at the current time for the selected property
4. WHEN Delete/Backspace is pressed THEN selected keyframes SHALL be deleted
5. WHEN Home/End is pressed THEN the playhead SHALL jump to start/end of sequence

## Field Types Requiring Animation Support

The following field types must support keyframe animation:

| Field Type | Value Type | Interpolation |
|------------|------------|---------------|
| NumberField | `number` | Numeric lerp with bezier easing |
| BooleanField | `boolean` | Step (no interpolation) |
| StringField | `string` | Step (no interpolation) |
| StringLiteralField | `string` (enum) | Step (no interpolation) |
| ColorField | `#RRGGBBAA` or `[r,g,b,a]` | RGBA component interpolation |
| DateField | `Temporal.PlainDateTime` | Numeric epoch ms interpolation |
| Vec2Field | `{x, y}` or `[x, y]` | Per-component interpolation |
| Vec3Field | `{x, y, z}` or `[x, y, z]` | Per-component interpolation |
| Point2DField | `{lng, lat}` or `[lng, lat]` | Per-component interpolation |
| Point3DField | `{lng, lat, alt}` | Per-component interpolation |
| CompoundPropsField | Nested fields | Recursive per-field interpolation |

**Not animatable:** CodeField, DataField, Accessor fields (function values)
