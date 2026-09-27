/** Names of the reader's own shelf groups (LibraryEntry.shelfGroup). */

/** A group name as the reader typed it, trimmed, with runs of spaces closed up. */
export function tidyGroupName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** Whether two names are the same group: "bluey" and "Bluey " are. */
export function sameGroupName(a: string, b: string): boolean {
  return tidyGroupName(a).toLowerCase() === tidyGroupName(b).toLowerCase()
}
