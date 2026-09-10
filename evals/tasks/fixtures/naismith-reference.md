# Naismith's Rule — Hiking Time Estimation Reference

## Overview

Naismith's Rule (1892) estimates hiking time from distance and elevation change.
It is the standard formula used in mountaineering, trail planning, and outdoor
navigation. This document provides the formulas and constants needed to implement
a calculator.

## Base Rule

- **Horizontal speed**: 5 km/h on flat ground (3.1 mph)
- **Ascent penalty**: +1 minute per 10 meters of elevation gain
  (equivalently: +60 minutes per 600m)

## Langmuir's Descent Corrections (1984)

The descent correction depends on slope angle:

| Slope range | Correction |
|-------------|-----------|
| < 5° (gentle) | No correction (flat speed applies) |
| 5–12° (moderate) | Subtract 10 min per 300m descent |
| > 12° (steep) | Add 10 min per 300m descent |

## Terrain Factor

A multiplier on effective distance to account for surface difficulty:

| Surface | Factor |
|---------|--------|
| Paved road / sidewalk | 1.0 |
| Well-maintained trail | 1.2 |
| Rough trail / rocky | 1.5 |
| Off-trail / bushwhack | 1.8 |
| Scree / talus | 2.0 |

## Terrain Factor Heuristic

When terrain type is unknown, estimate from distance (km):

```
if distance > 15:  factor = 1.1  (long routes tend to follow maintained trails)
if distance 5–15:  factor = 1.3  (mix of trail and terrain)
if distance < 5:   factor = 1.5  (short routes often go direct / off-trail)
if distance < 0.5: factor = 1.8  (very short = likely scrambling)
```

## Slope Estimation

When explicit slope is not provided, estimate from elevation and distance:

```
slope_deg = atan2(elevation_gain_m, distance_m) × (180 / π)
```

## Combined Formula

```
horizontal_time_min = (distance_km × terrain_factor / base_speed_kmh) × 60
ascent_time_min     = elevation_gain_m / 10
descent_correction  = see Langmuir table above, using slope_deg and descent_m

total_time_min = horizontal_time_min + ascent_time_min + descent_correction
```

## Example Calculations

### Example 1: Moderate day hike
- Distance: 12 km, Elevation gain: 600m, Descent: 400m, Trail terrain (1.2)
- Slope: atan2(600, 12000) = 2.9° → gentle descent correction = 0
- Horizontal: (12 × 1.2 / 5) × 60 = 172.8 min
- Ascent: 600 / 10 = 60 min
- Total: **232.8 min ≈ 3h 53min**

### Example 2: Short steep scramble
- Distance: 2 km, Elevation gain: 450m, Descent: 100m, Rough trail (1.5)
- Slope for descent: atan2(100, 2000) = 2.9° → no correction
- Horizontal: (2 × 1.5 / 5) × 60 = 36 min
- Ascent: 450 / 10 = 45 min
- Total: **81 min ≈ 1h 21min**

### Example 3: Long ridge walk with steep descent
- Distance: 18 km, Elevation gain: 300m, Descent: 800m, Maintained trail (1.2)
- Slope for descent: atan2(800, 18000) = 2.5° → gentle, no correction
  (but if descent were concentrated: atan2(800, 3000) = 14.9° → steep → +10×(800/300) = +26.7 min)
- Horizontal: (18 × 1.2 / 5) × 60 = 259.2 min
- Ascent: 300 / 10 = 30 min
- Total (assuming distributed descent): **289.2 min ≈ 4h 49min**

## Constants Summary

| Name | Value | Unit |
|------|-------|------|
| base_speed | 5 | km/h |
| ascent_rate | 10 | meters per minute penalty |
| gentle_descent_bonus | 10 | min saved per 300m descent (5–12°) |
| steep_descent_penalty | 10 | min added per 300m descent (>12°) |
