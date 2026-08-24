export async function parseCashuTokenAmount(token: string): Promise<number> {
  const mod = await import('@cashu/cashu-ts')
  // getTokenMetadata, not getDecodedToken: the latter maps short (v2) keyset
  // IDs against known mint keysets and throws "Couldn't map short keyset ID…"
  // when none are provided — and every cashuB token from the host/worker coco
  // wallets uses short IDs. getTokenMetadata decodes cashuA + cashuB and sums
  // proof amounts without keyset mapping (and strips URI prefixes itself).
  return mod.getTokenMetadata(token).amount
}
