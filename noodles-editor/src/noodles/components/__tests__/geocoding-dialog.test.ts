import { describe, expect, it } from 'vitest'
import {
	extractPlaceNameFromUrl,
	isShortUrl,
	parseCoordinates,
	parseGoogleMapsUrl,
} from '../geocoding-dialog'

describe('Geocoding Dialog Parsing Utilities', () => {
	describe('isShortUrl', () => {
		it('should detect goo.gl/maps short URLs', () => {
			expect(isShortUrl('https://goo.gl/maps/abc123')).toBe(true)
		})

		it('should detect maps.app.goo.gl short URLs', () => {
			expect(isShortUrl('https://maps.app.goo.gl/xyz789')).toBe(true)
		})

		it('should detect g.co/maps short URLs', () => {
			expect(isShortUrl('https://g.co/maps/test')).toBe(true)
		})

		it('should return false for regular Google Maps URLs', () => {
			expect(isShortUrl('https://www.google.com/maps/@40.7128,-74.0060,15z')).toBe(false)
		})

		it('should return false for non-map URLs', () => {
			expect(isShortUrl('https://www.google.com')).toBe(false)
		})
	})

	describe('extractPlaceNameFromUrl', () => {
		it('should extract place name from place URL', () => {
			const url = 'https://www.google.com/maps/place/New+York,+NY/@40.7128,-74.0060,15z'
			const result = extractPlaceNameFromUrl(url)
			expect(result).toBe('New York, NY')
		})

		it('should decode URL-encoded characters', () => {
			const url = 'https://www.google.com/maps/place/Caf%C3%A9+Paris/@48.8566,2.3522,15z'
			const result = extractPlaceNameFromUrl(url)
			expect(result).toBe('Café Paris')
		})

		it('should return null for URLs without place', () => {
			const url = 'https://www.google.com/maps/@40.7128,-74.0060,15z'
			const result = extractPlaceNameFromUrl(url)
			expect(result).toBeNull()
		})

		it('should handle multi-word places', () => {
			const url = 'https://www.google.com/maps/place/Los+Angeles,+CA/@34.0522,-118.2437,15z'
			const result = extractPlaceNameFromUrl(url)
			expect(result).toBe('Los Angeles, CA')
		})
	})

	describe('parseGoogleMapsUrl', () => {
		it('should parse direct coordinate URLs', () => {
			const url = 'https://www.google.com/maps/@40.7128,-74.0060,15z'
			const result = parseGoogleMapsUrl(url)
			expect(result).toEqual({ lat: 40.7128, lng: -74.006 })
		})

		it('should parse place URLs with coordinates', () => {
			const url = 'https://www.google.com/maps/place/New+York,+NY/@40.7128,-74.0060,15z'
			const result = parseGoogleMapsUrl(url)
			expect(result).toEqual({ lat: 40.7128, lng: -74.006 })
		})

		it('should handle negative coordinates', () => {
			const url = 'https://www.google.com/maps/@-33.8688,151.2093,15z'
			const result = parseGoogleMapsUrl(url)
			expect(result).toEqual({ lat: -33.8688, lng: 151.2093 })
		})

		it('should parse viewport radius from URLs with meters', () => {
			const url = 'https://www.google.com/maps/@37.7305776,-122.4770007,1328m'
			const result = parseGoogleMapsUrl(url)
			expect(result).toEqual({ lat: 37.7305776, lng: -122.4770007, radiusMeters: 1328 })
		})

		it('should parse place URLs with viewport radius in meters', () => {
			const url = 'https://www.google.com/maps/place/Whole+Foods+Market/@37.7305776,-122.4770007,1328m/data'
			const result = parseGoogleMapsUrl(url)
			expect(result).toEqual({ lat: 37.7305776, lng: -122.4770007, radiusMeters: 1328 })
		})

		it('should parse coordinates without radius when no unit or z unit', () => {
			const url = 'https://www.google.com/maps/@40.7128,-74.0060'
			const result = parseGoogleMapsUrl(url)
			expect(result).toEqual({ lat: 40.7128, lng: -74.006 })
		})

		it('should return null for invalid URLs', () => {
			const url = 'https://www.google.com/maps'
			const result = parseGoogleMapsUrl(url)
			expect(result).toBeNull()
		})

		it('should return null for non-map URLs', () => {
			const url = 'https://www.google.com/search?q=maps'
			const result = parseGoogleMapsUrl(url)
			expect(result).toBeNull()
		})
	})

	describe('parseCoordinates', () => {
		it('should parse standard lat,lng format offering both interpretations', () => {
			const results = parseCoordinates('40.7128, -74.0060')
			// Both values are within -90 to 90, so ambiguous
			expect(results).toHaveLength(2)
			// First result should be lat,lng (higher confidence)
			expect(results[0].coordinates).toEqual({ latitude: 40.7128, longitude: -74.006 })
			expect(results[0].confidence).toBe(0.7)
		})

		it('should detect unambiguous coordinates (lng clearly > 90)', () => {
			// 151.2093 > 90, so it can only be longitude
			const results = parseCoordinates('-33.8688, 151.2093')
			expect(results).toHaveLength(1)
			expect(results[0].coordinates).toEqual({ latitude: -33.8688, longitude: 151.2093 })
			expect(results[0].confidence).toBe(1.0)
		})

		it('should offer both interpretations for ambiguous coordinates', () => {
			const results = parseCoordinates('40.7128, 50.4567')
			expect(results).toHaveLength(2)

			// First result should be lat,lng (higher confidence)
			expect(results[0].coordinates).toEqual({ latitude: 40.7128, longitude: 50.4567 })
			expect(results[0].confidence).toBe(0.7)

			// Second result should be lng,lat (lower confidence)
			expect(results[1].coordinates).toEqual({ latitude: 50.4567, longitude: 40.7128 })
			expect(results[1].confidence).toBe(0.5)
		})

		it('should handle coordinates without spaces', () => {
			const results = parseCoordinates('40.7128,-74.0060')
			// Both values are within -90 to 90, so ambiguous - offers both
			expect(results).toHaveLength(2)
			expect(results[0].coordinates).toEqual({ latitude: 40.7128, longitude: -74.006 })
		})

		it('should handle coordinates with parentheses', () => {
			const results = parseCoordinates('(40.7128, -74.0060)')
			// Both values are within -90 to 90, so ambiguous - offers both
			expect(results).toHaveLength(2)
			expect(results[0].coordinates).toEqual({ latitude: 40.7128, longitude: -74.006 })
		})

		it('should return empty array for invalid input', () => {
			expect(parseCoordinates('not coordinates')).toEqual([])
			expect(parseCoordinates('40.7128')).toEqual([]) // Only one number
			expect(parseCoordinates('40.7128, -74.0060, 15')).toEqual([]) // More than 2 numbers
		})

		it('should reject coordinates outside valid ranges', () => {
			// Latitude > 90
			expect(parseCoordinates('95.0, -74.0')).toEqual([])

			// Latitude < -90
			expect(parseCoordinates('-95.0, -74.0')).toEqual([])

			// Longitude > 180
			expect(parseCoordinates('40.0, 185.0')).toEqual([])

			// Longitude < -180
			expect(parseCoordinates('40.0, -185.0')).toEqual([])
		})

		it('should format labels with 5 decimal places', () => {
			const results = parseCoordinates('40.712800001, -74.006000002')
			expect(results[0].label).toBe('40.71280, -74.00600 (Lat, Lng) • Most common')
		})
	})

	describe('parseCoordinates edge cases', () => {
		it('should handle zero coordinates', () => {
			const results = parseCoordinates('0, 0')
			expect(results).toHaveLength(1)
			expect(results[0].coordinates).toEqual({ latitude: 0, longitude: 0 })
		})

		it('should handle boundary values', () => {
			const results = parseCoordinates('90, 180')
			expect(results).toHaveLength(1)
			expect(results[0].coordinates).toEqual({ latitude: 90, longitude: 180 })
		})

		it('should handle negative boundary values', () => {
			const results = parseCoordinates('-90, -180')
			expect(results).toHaveLength(1)
			expect(results[0].coordinates).toEqual({ latitude: -90, longitude: -180 })
		})

		it('should not offer duplicate interpretations when a === b', () => {
			const results = parseCoordinates('50, 50')
			expect(results).toHaveLength(1) // Only one interpretation
		})
	})
})
