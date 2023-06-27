import { type CompletionItem } from "vscode-languageserver-protocol";

interface ExtendCompletionItem {
  positions?: ReadonlyArray<number>
  score: number
  originItem: CompletionItem
}

function filterItems(prefix: string, items: CompletionItem[]) {
  const arr: ExtendCompletionItem[] = []
  const len = prefix.length
  const emptyInput = len === 0
  const codes = getCharCodes(prefix)
  for (let i = 0; i < items.length; i++) {
    const item: ExtendCompletionItem = {
      score: 0,
      originItem: items[i],
    };
    const { label } = item.originItem;
    const filterText = item.originItem.filterText ?? label

    if (filterText.length < len) continue
    if (!emptyInput) {
      let positions: ReadonlyArray<number> | undefined
      let score: number
      if (item.originItem.kind && filterText === prefix) {
        score = 64;
        positions = Array.from({ length: filterText.length }, (_, i) => i)
      } else {
        const res = matchScoreWithPositions(filterText, codes)
        score = res == null ? 0 : res[0]
        if (res != null) {
          positions = res[1]
        }
      }

      if (score === 0) continue
      if (label === filterText) {
        item.positions = positions;
      } else if (positions && positions.length) {
        const idx = label.indexOf(filterText.slice(0, (positions[positions.length - 1] ?? 0) + 1))
        if (idx !== -1) {
          item.positions = positions.map(i => i + idx)
        }
      }

      item.score = score
    }

    arr.push(item)
  }

  arr.sort((a, b) => {
    const sa = a.originItem.sortText
    const sb = b.originItem.sortText
    if (a.score !== b.score) return b.score - a.score
    if (sa && sb && sa !== sb) return sa < sb ? -1  : 1
    if (prefix.length === 0) return 0

    return 0
  })

  return arr.map(item => item.originItem)
}

function getCharCodes(str: string) {
  const res: number[] = [];
  for (let i = 0; i < str.length; i++) {
    res.push(str.charCodeAt(i))
  }
  return res
}

function wordChar(ch: number): boolean {
  return (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90)
}

function findIndex<T>(array: ReadonlyArray<T>, val: T, start = 0): number {
  let idx = -1
  for (let i = start; i < array.length; i++) {
    if (array[i] === val) {
      idx = i
      break
    }
  }
  return idx
}

// lowerCase 1, upperCase 2
function getCase(code: number | undefined): number {
  if (code == null) return 0
  if (code >= 97 && code <= 122) return 1
  if (code >= 65 && code <= 90) return 2
  return 0
}

function getNextWord(codes: ReadonlyArray<number>, index: number): [number, number] | undefined {
  let preCase = index == 0 ? 0 : getCase(codes[index - 1])
  for (let i = index; i < codes.length; i++) {
    const curr = getCase(codes[i])
    if (curr > 0 && curr != preCase) {
      return [i, codes[i]]
    }
    preCase = curr
  }
  return undefined
}

function matchScoreWithPositions(word: string, input: number[]) {
  if (input.length === 0 || word.length < input.length) return undefined
  return nextScore(getCharCodes(word), 0, input, [])
}

function caseScore(input: number, curr: number, divide = 1): number {
  if (input === curr) return 1 / divide
  if (curr + 32 === input) return 0.5 / divide
  return 0
}

function nextScore(codes: ReadonlyArray<number>, index: number, inputCodes: ReadonlyArray<number>, positions: ReadonlyArray<number>): [number, ReadonlyArray<number>] | undefined {
  if (inputCodes.length === 0) return [0, positions]
  const len = codes.length
  if (index >= len) return undefined
  const input = inputCodes[0]
  const nextCodes = inputCodes.slice(1)
  // not alphabet
  if (!wordChar(input)) {
    const idx = findIndex(codes, input, index)
    if (idx == -1) return undefined
    const score = idx == 0 ? 5 : 1
    const next = nextScore(codes, idx + 1, nextCodes, [...positions, idx])
    return next === undefined ? undefined : [score + next[0], next[1]]
  }
  // check beginning
  const isStart = positions.length == 0
  const score = caseScore(input, codes[index], isStart ? 0.2 : 1)
  if (score > 0) {
    const next = nextScore(codes, index + 1, nextCodes, [...positions, index])
    return next === undefined ? undefined : [score + next[0], next[1]]
  }
  // check next word
  const positionMap: Map<number, ReadonlyArray<number>> = new Map()
  const word = getNextWord(codes, index + 1)
  if (word != null) {
    let score = caseScore(input, word[1], isStart ? 0.5 : 1)
    if (score > 0) {
      const ps = [...positions, word[0]]
      if (score === 0.5) score = 0.75
      const next = nextScore(codes, word[0] + 1, nextCodes, ps)
      if (next !== undefined) positionMap.set(score + next[0], next[1])
    }
  }
  // find fuzzy
  for (let i = index + 1; i < len; i++) {
    const score = caseScore(input, codes[i], isStart ? 1 : 10)
    if (score > 0) {
      const next = nextScore(codes, i + 1, nextCodes, [...positions, i])
      if (next !== undefined) positionMap.set(score + next[0], next[1])
      break
    }
  }
  if (positionMap.size == 0) {
    // Try match previous position
    if (positions.length > 0) {
      const last = positions[positions.length - 1]
      if (last > 0 && codes[last] !== input && codes[last - 1] === input) {
        const ps = positions.slice()
        ps.splice(positions.length - 1, 0, last - 1)
        const next = nextScore(codes, last + 1, nextCodes, ps)
        if (next === undefined) return undefined
        return [0.5 + next[0], next[1]]
      }
    }
    return undefined
  }
  const max = Math.max(...positionMap.keys())
  return [max, positionMap.get(max) ?? []]
}

export default filterItems
