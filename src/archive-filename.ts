/** Archive names are ASCII; accept the quoted and token forms sent by Express. */
export function archiveFilename(disposition: string | null): string {
  const match =
    /(?:^|;)\s*filename=(?:"([^"]+)"|([^";\s]+))(?=\s*(?:;|$))/i.exec(
      disposition ?? "",
    );
  return match?.[1] ?? match?.[2] ?? "meetloom.mldx";
}
