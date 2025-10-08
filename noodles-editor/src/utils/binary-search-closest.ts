export default function binarySearchClosest(arr: number[], val: number, i = -1) {
  let low = 0
  let high = arr.length - 1
  let mid: number

  if (i >= 0 && i < arr.length) {
    // If i is a valid index in the array, start the search from there
    if (val === arr[i]) {
      return i
    }
    if (val < arr[i]) {
      high = i - 1
    } else {
      low = i + 1
    }
  }

  while (low <= high) {
    mid = Math.floor((low + high) / 2)

    if (arr[mid] === val) {
      return mid
    }
    if (arr[mid] < val) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  // If the value is not found, return the index of the closest element
  if (high < 0) {
    return low
  }
  if (low >= arr.length) {
    return high
  }
  const diffLow = Math.abs(arr[low] - val)
  const diffHigh = Math.abs(arr[high] - val)

  if (diffLow <= diffHigh) {
    return low
  }
  return high
}
