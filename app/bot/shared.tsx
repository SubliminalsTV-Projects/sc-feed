import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

// The Discord-provided install link: uses the app's default install settings
// (bot + applications.commands, View Channels / Send Messages / Embed Links).
export const BOT_INVITE_URL = 'https://discord.com/oauth2/authorize?client_id=1484283647027712232'

export function BotPage({ back, title, updated, children }: {
  back: { href: string; label: string }
  title: string
  updated?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-10 sm:py-16">
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant/60 hover:text-on-surface mb-8 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {back.label}
        </Link>
        <h1 className="text-3xl sm:text-4xl font-headline font-black text-on-surface mb-2">{title}</h1>
        {updated && <p className="text-sm font-body text-on-surface-variant/70 mb-10">Last updated: {updated}</p>}
        {children}
      </div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-headline font-black text-on-surface mb-3 pb-2 border-b border-outline-variant/30">
        {title}
      </h2>
      <div className="space-y-3 text-sm font-body text-on-surface-variant leading-relaxed [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:list-disc [&_li]:marker:text-primary-container/40 [&_strong]:text-on-surface [&_code]:text-[12px] [&_code]:bg-surface-container-high [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-on-surface [&_a]:text-primary-container [&_a:hover]:underline">
        {children}
      </div>
    </section>
  )
}
