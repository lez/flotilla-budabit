import {describe, expect, it} from "vitest"
import {
  IssueEventSchema,
  PullRequestEventSchema,
  PullRequestUpdateEventSchema,
  StatusEventSchema,
} from "../src/utils/validation"

const bridgeTags = [
  ["proxy", "https://github.com/nostr-protocol/nips/pull/1", "github"],
  ["source-author", "contributor", "https://github.com/contributor"],
  ["source-key", "github:pull-request:1"],
  ["imported", ""],
  ["original_date", "1700000000"],
  ["original_updated_at", "1700000100"],
]

describe("imported collaboration event validation", () => {
  it("accepts bridge metadata on issues", () => {
    const result = IssueEventSchema.safeParse({
      kind: 1621,
      content: "Imported issue",
      tags: [["a", "30617:owner:repo"], ...bridgeTags],
    })

    expect(result.success).toBe(true)
  })

  it("accepts bridge metadata on pull requests", () => {
    const result = PullRequestEventSchema.safeParse({
      kind: 1618,
      content: "Imported PR",
      tags: [["a", "30617:owner:repo"], ["c", "a".repeat(40)], ...bridgeTags],
    })

    expect(result.success).toBe(true)
  })

  it("accepts bridge metadata on pull request updates", () => {
    const result = PullRequestUpdateEventSchema.safeParse({
      kind: 1619,
      content: "",
      tags: [
        ["a", "30617:owner:repo"],
        ["E", "event-id"],
        ["P", "author"],
        ["c", "b".repeat(40)],
        ...bridgeTags,
      ],
    })

    expect(result.success).toBe(true)
  })

  it("accepts imported draft status metadata", () => {
    const result = StatusEventSchema.safeParse({
      kind: 1633,
      content: "Imported current GitHub draft state.",
      tags: [
        ["e", "event-id", "", "root"],
        ["p", "author"],
        ["proxy", "https://github.com/nostr-protocol/nips/pull/1#draft-state", "github"],
        ["imported", ""],
        ["original_date", "1700000100"],
      ],
    })

    expect(result.success).toBe(true)
  })
})
