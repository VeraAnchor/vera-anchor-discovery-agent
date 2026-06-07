import { Helmet } from "react-helmet-async";

const SITE_NAME = "Vera Anchor";
const SITE_URL = "https://veraanchor.com";
const DEFAULT_OG_IMAGE = "https://veraanchor.com/og-image.png";

type SeoProps = Readonly<{
  title: string;
  description: string;
  path?: string;
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | readonly Record<string, unknown>[] | null;
}>;

function absoluteUrl(path = "/") {
  const clean = String(path || "/").trim();

  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return clean;
  }

  if (clean === "/") return SITE_URL;

  return `${SITE_URL}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

export default function Seo({
  title,
  description,
  path = "/",
  image = DEFAULT_OG_IMAGE,
  type = "website",
  noindex = false,
  jsonLd = null,
}: SeoProps) {
  const canonical = absoluteUrl(path);
  const cleanTitle = String(title || "").trim();
  const cleanDescription = String(description || "").trim();

  const resolvedTitle =
    !cleanTitle || cleanTitle === SITE_NAME
      ? SITE_NAME
      : cleanTitle.endsWith(`| ${SITE_NAME}`)
        ? cleanTitle
        : `${cleanTitle} | ${SITE_NAME}`;

  const resolvedImage = image
    ? absoluteUrl(image)
    : absoluteUrl(DEFAULT_OG_IMAGE);

  return (
    <Helmet>
      <title>{resolvedTitle}</title>
      <meta name="description" content={cleanDescription} />
      <link rel="canonical" href={canonical} />

      {noindex ? <meta name="robots" content="noindex,nofollow" /> : null}

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={resolvedTitle} />
      <meta property="og:description" content={cleanDescription} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={resolvedImage} />
      <meta property="og:image:alt" content={`${SITE_NAME} social preview`} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={resolvedTitle} />
      <meta name="twitter:description" content={cleanDescription} />
      <meta name="twitter:image" content={resolvedImage} />
      <meta name="twitter:image:alt" content={`${SITE_NAME} social preview`} />

      {jsonLd ? (
        <script key="json-ld" type="application/ld+json">
          {JSON.stringify(jsonLd)}
        </script>
      ) : null}
    </Helmet>
  );
}