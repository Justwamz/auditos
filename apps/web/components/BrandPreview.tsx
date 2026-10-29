import type { CSSProperties } from 'react';
import { derivePalette } from '@auditos/brand';
import { themeStyle } from '@/lib/theme';

/** Turns the sanitised `--name: value;` declarations into a style object for one container. */
function scoped(css: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at > 0) style[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return style as CSSProperties;
}

/** The palette for the colours currently picked, or null while either colour code is not a full code yet. */
export function previewPalette(primary: string, secondary: string) {
  try {
    return derivePalette({ primary, secondary });
  } catch {
    return null;
  }
}

/**
 * What the colours will look like: the menu, a button, a table row and the top of an invoice. The colours are set
 * on this one box only (through the same sanitiser the app layout uses), so nothing outside the box changes.
 */
export function BrandPreview({ palette, name, logoId }: { palette: Record<string, string>; name: string; logoId: string | null }) {
  return (
    <div className="brand-preview" data-testid="brand-preview" style={scoped(themeStyle(palette))}>
      <div className="bp-menu" aria-label="Menu preview" role="group">
        <div className="bp-menu-name">{name}</div>
        <div className="bp-menu-item bp-menu-active">Clients</div>
        <div className="bp-menu-item">Billing</div>
        <div className="bp-menu-powered">Powered by AuditOS</div>
      </div>
      <div className="bp-body">
        <div className="bp-row">
          <span className="bp-button">Save</span>
          <span className="bp-link">A link looks like this</span>
        </div>
        <table className="bp-table" aria-label="Table row preview">
          <tbody>
            <tr>
              <td>Mwangaza Traders Ltd</td>
              <td className="num">KES 120,000</td>
            </tr>
          </tbody>
        </table>
        <div className="bp-invoice" role="group" aria-label="Invoice header preview">
          {logoId && <img src={`/api/branding/logo/${logoId}`} alt="" height={36} />}
          <div className="bp-invoice-name">{name}</div>
          <div className="bp-invoice-title">Invoice</div>
        </div>
      </div>
    </div>
  );
}
