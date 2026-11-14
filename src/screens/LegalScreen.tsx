import Markdown, { type Components } from 'react-markdown'
import { Link } from 'react-router'
import { SubHeader } from '@/components/layout'
import privacy from '../../docs/PRIVACY.md?raw'
import refunds from '../../docs/REFUNDS.md?raw'
import terms from '../../docs/TERMS.md?raw'

export const LEGAL_DOCS = {
  privacy: { title: 'Privacy Policy', source: privacy },
  terms: { title: 'Terms of Service', source: terms },
  refunds: { title: 'Refund Policy', source: refunds },
} as const

export type LegalDoc = keyof typeof LEGAL_DOCS

const components: Components = {
  h1: () => null, // the page header shows the title
  h2: ({ children }) => <h2 className="mt-6 text-xl font-bold tracking-[-0.01em]">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 font-sans text-base font-bold">{children}</h3>,
  p: ({ children }) => <p className="text-[15px] leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[15px] leading-relaxed">{children}</ol>,
  a: ({ href, children }) =>
    href?.startsWith('/') ? (
      <Link to={href} className="text-link underline underline-offset-2">
        {children}
      </Link>
    ) : (
    <a href={href} className="text-link underline underline-offset-2" target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
      {children}
    </a>
    ),
  blockquote: ({ children }) => <blockquote className="rounded-lg bg-warning-tint px-4 py-3 text-warning-text [&_p]:text-sm">{children}</blockquote>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
}

/** Renders one of the Markdown policy documents in docs/. */
export function LegalScreen({ doc }: { doc: LegalDoc }) {
  const { title, source } = LEGAL_DOCS[doc]
  return (
    <div className="flex w-full max-w-[720px] flex-col gap-4 md:mx-auto">
      <SubHeader title={title} />
      <article className="flex flex-col gap-3 rounded-card bg-card p-5 md:p-8">
        <Markdown components={components} skipHtml>
          {source}
        </Markdown>
      </article>
    </div>
  )
}
