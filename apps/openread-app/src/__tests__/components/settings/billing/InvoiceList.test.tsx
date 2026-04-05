import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InvoiceList } from '@/components/settings/billing/InvoiceList';
import type { Invoice } from '@/hooks/useSubscription';

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, vars?: Record<string, unknown>) => {
    if (!vars) return key;
    let result = key;
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(`{{${k}}}`, String(v));
    }
    return result;
  },
}));

vi.mock('@/utils/misc', () => ({
  getLocale: () => 'en-US',
}));

vi.mock('@/utils/tailwind', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ─── Helpers ─────────────────────────────────────────────────────────

// Use noon UTC to avoid timezone date shifting in formatShortDate
const invoiceDate1 = new Date('2026-03-15T12:00:00Z');
const invoiceDate2 = new Date('2026-02-15T12:00:00Z');
const invoiceDate3 = new Date('2026-01-15T12:00:00Z');

/** Format the same way the component does, for stable assertions. */
function expectedDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const sampleInvoices: Invoice[] = [
  {
    id: 'inv_1',
    date: invoiceDate1,
    amount: 999,
    status: 'paid',
    invoiceUrl: 'https://stripe.com/inv/1',
    pdfUrl: 'https://stripe.com/inv/1.pdf',
  },
  {
    id: 'inv_2',
    date: invoiceDate2,
    amount: 499,
    status: 'paid',
    invoiceUrl: 'https://stripe.com/inv/2',
    pdfUrl: 'https://stripe.com/inv/2.pdf',
  },
  {
    id: 'inv_3',
    date: invoiceDate3,
    amount: 499,
    status: 'paid',
    invoiceUrl: 'https://stripe.com/inv/3',
    pdfUrl: '',
  },
];

// ─── Tests ───────────────────────────────────────────────────────────

describe('InvoiceList', () => {
  afterEach(() => {
    cleanup();
  });

  it('should show loading skeleton when isLoading is true', () => {
    render(<InvoiceList invoices={[]} isLoading />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show empty state when no invoices', () => {
    render(<InvoiceList invoices={[]} />);
    expect(screen.getByText('No invoices yet')).toBeTruthy();
  });

  it('should display Invoices title', () => {
    render(<InvoiceList invoices={sampleInvoices} />);
    expect(screen.getByText('Invoices')).toBeTruthy();
  });

  it('should display table headers', () => {
    render(<InvoiceList invoices={sampleInvoices} />);
    expect(screen.getByText('Date')).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();
    // "Invoice" header
    const invoiceHeaders = screen.getAllByText('Invoice');
    expect(invoiceHeaders.length).toBeGreaterThan(0);
  });

  it('should display invoice dates', () => {
    render(<InvoiceList invoices={sampleInvoices} />);
    expect(screen.getByText(expectedDate(invoiceDate1))).toBeTruthy();
    expect(screen.getByText(expectedDate(invoiceDate2))).toBeTruthy();
    expect(screen.getByText(expectedDate(invoiceDate3))).toBeTruthy();
  });

  it('should display formatted amounts', () => {
    render(<InvoiceList invoices={sampleInvoices} />);
    expect(screen.getByText('$9.99')).toBeTruthy();
    // Two invoices at $4.99
    const fourNinetyNine = screen.getAllByText('$4.99');
    expect(fourNinetyNine.length).toBe(2);
  });

  it('should show PDF download link when pdfUrl is available', () => {
    render(<InvoiceList invoices={sampleInvoices} />);
    const pdfLinks = screen.getAllByText('PDF');
    // inv_1 and inv_2 have pdfUrl, inv_3 has empty string
    expect(pdfLinks.length).toBe(2);
  });

  it('should open PDF in new tab', () => {
    render(<InvoiceList invoices={sampleInvoices} />);
    const pdfLink = screen.getAllByLabelText('Download invoice PDF')[0];
    expect(pdfLink?.getAttribute('target')).toBe('_blank');
    expect(pdfLink?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('should display description text', () => {
    render(<InvoiceList invoices={sampleInvoices} />);
    expect(screen.getByText('Your recent invoices')).toBeTruthy();
  });
});
