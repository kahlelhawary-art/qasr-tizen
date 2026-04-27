import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { COLORS, formatDate, formatCurrency } from '../lib/constants';

const ABRECHNUNGSARTEN = [
  'Umwidmung § 45a SGB XI',
  'Verhinderungspflege § 39 SGB XI',
  'Entlastungsbetrag § 45b SGB XI',
  'Privat',
];

const EMPTY_FORM = {
  client_id: '',
  issue_date: new Date().toISOString().split('T')[0],
  due_date: '',
  period_start: '',
  period_end: '',
  abrechnungsart: ABRECHNUNGSARTEN[1],
  notes: '',
  items: [{ description: '', quantity: '', unit: 'Std.', unit_price: '', total: '' }],
};

function extractNumber(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const match = String(value).replace(',', '.').match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : 0;
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: COLORS.surface, borderRadius: 12,
        maxWidth: 420, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        padding: 28,
      }}>
        <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 16 }}>⚠️</div>
        <p style={{ fontSize: 15, color: COLORS.ink, textAlign: 'center', marginBottom: 24, lineHeight: 1.6 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={onCancel} style={{
            padding: '9px 24px', borderRadius: 8, fontSize: 14,
            border: '1px solid ' + COLORS.border, background: COLORS.surface,
            color: COLORS.ink, cursor: 'pointer', fontWeight: 500,
          }}>
            Abbrechen
          </button>
          <button onClick={onConfirm} style={{
            padding: '9px 24px', borderRadius: 8, fontSize: 14,
            border: 'none', background: COLORS.danger,
            color: 'white', cursor: 'pointer', fontWeight: 600,
          }}>
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Rechnungen() {
  const [rechnungen, setRechnungen] = useState([]);
  const [clients, setClients] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [r, c, s] = await Promise.all([
        supabase.from('invoices')
          .select('*, clients(first_name, last_name, address, versicherungsnummer, krankenkassen(name, address))')
          .order('issue_date', { ascending: false }),
        supabase.from('clients')
          .select('id, first_name, last_name, address, versicherungsnummer, krankenkassen(name, address)')
          .order('last_name'),
        supabase.from('company_settings').select('*').eq('id', 1).single(),
      ]);
      if (r.error) throw r.error;
      setRechnungen(r.data || []);
      setClients(c.data || []);
      if (s.data) setSettings(s.data);
    } catch (e) {
      console.error('Fehler:', e);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    const days = parseInt(settings?.payment_days || 14);
    const due = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
    setForm({ ...EMPTY_FORM, items: [{ description: '', quantity: '', unit: 'Std.', unit_price: '', total: '' }], due_date: due });
    setModalOpen(true);
  }

  function handleFormChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleItemChange(i, field, val) {
    setForm((f) => {
      const items = [...f.items];
      items[i] = { ...items[i], [field]: val };
      if (field === 'quantity' || field === 'unit_price') {
        const q = extractNumber(field === 'quantity' ? val : items[i].quantity);
        const p = parseFloat(field === 'unit_price' ? val : items[i].unit_price) || 0;
        items[i].total = (q * p).toFixed(2);
      }
      return { ...f, items };
    });
  }

  function addItem() {
    setForm((f) => ({
      ...f,
      items: [...f.items, { description: '', quantity: '', unit: 'Std.', unit_price: '', total: '' }],
    }));
  }

  function removeItem(i) {
    setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  }

  const subtotal = form.items.reduce((s, it) => s + (parseFloat(it.total) || 0), 0);
  const total = subtotal;
  const selectedClient = clients.find(c => c.id === form.client_id);

  async function handleSave() {
    if (!form.client_id) return;
    setSaving(true);
    try {
      const prefix = settings?.invoice_prefix || 'RE';
      const year = new Date().getFullYear();
      const count = rechnungen.filter(r => r.number?.startsWith(prefix + '-' + year)).length + 1;
      const number = prefix + '-' + year + '-' + String(count).padStart(3, '0');

      const cleanItems = form.items.map(it => ({
        description: it.description,
        quantity: it.quantity || '',
        unit: it.unit || 'Std.',
        unit_price: parseFloat(it.unit_price) || 0,
        total: parseFloat(it.total) || 0,
      }));

      const { error } = await supabase.from('invoices').insert([{
        number,
        client_id: form.client_id,
        issue_date: form.issue_date,
        due_date: form.due_date || null,
        period_start: form.period_start || null,
        period_end: form.period_end || null,
        items: cleanItems,
        subtotal: subtotal.toFixed(2),
        tax_rate: 0,
        tax_amount: '0.00',
        total: total.toFixed(2),
        tax_mode: 'befreit',
        notes: form.notes,
        abrechnungsart: form.abrechnungsart,
        status: 'offen',
      }]);
      if (error) throw error;
      setModalOpen(false);
      await fetchAll();
    } catch (e) {
      console.error('Fehler:', e);
      alert('Fehler beim Speichern: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id, status) {
    try {
      const { error } = await supabase.from('invoices')
        .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await fetchAll();
    } catch (e) {
      console.error(e);
    }
  }

  const filtered = rechnungen.filter(r => !filterStatus || r.status === filterStatus);

  const STATUS_COLORS = {
    offen:      { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    bezahlt:    { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
    überfällig: { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
    storniert:  { bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb' },
  };

  function StatusBadge({ status }) {
    const s = STATUS_COLORS[status] || STATUS_COLORS.offen;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 10px', borderRadius: 20,
        fontSize: 12, fontWeight: 600,
        background: s.bg, color: s.color,
        border: '1px solid ' + s.border,
      }}>
        {status}
      </span>
    );
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: COLORS.ink }}>Rechnungen</h1>
          <p style={{ margin: '4px 0 0', color: COLORS.muted, fontSize: 14 }}>
            {rechnungen.length} Rechnung{rechnungen.length !== 1 ? 'en' : ''} insgesamt
          </p>
        </div>
        <button onClick={openCreate} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 500,
          background: COLORS.primary, color: '#fff',
          border: '1px solid ' + COLORS.primary, cursor: 'pointer',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Neue Rechnung
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['', 'offen', 'bezahlt', 'überfällig', 'storniert'].map((s) => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 13,
            border: '1px solid ' + (filterStatus === s ? COLORS.primary : COLORS.border),
            background: filterStatus === s ? COLORS.primarySoft : COLORS.surface,
            color: filterStatus === s ? COLORS.primary : COLORS.inkSoft,
            cursor: 'pointer', fontWeight: filterStatus === s ? 600 : 400,
          }}>
            {s === '' ? 'Alle' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: COLORS.muted }}>Wird geladen...</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: COLORS.surface, border: '1px solid ' + COLORS.border,
          borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink, marginBottom: 6 }}>
            Noch keine Rechnungen
          </div>
          <div style={{ fontSize: 14, color: COLORS.muted }}>
            Erstellen Sie Ihre erste Rechnung mit dem Button oben rechts.
          </div>
        </div>
      ) : (
        <div style={{ background: COLORS.surface, border: '1px solid ' + COLORS.border,
          borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: COLORS.surfaceAlt }}>
                {['Nummer', 'Empfänger', 'Abrechnung', 'Ausgestellt', 'Fällig', 'Betrag', 'Status', 'Aktionen'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12,
                    fontWeight: 600, color: COLORS.muted, letterSpacing: '0.05em',
                    borderBottom: '1px solid ' + COLORS.border, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const kasse = r.clients?.krankenkassen;
                return (
                  <tr key={r.id} style={{
                    borderBottom: i < filtered.length - 1 ? '1px solid ' + COLORS.border : 'none',
                  }}>
                    <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, color: COLORS.primary, whiteSpace: 'nowrap' }}>
                      {r.number}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14 }}>
                      <div style={{ fontWeight: 600, color: COLORS.ink }}>{kasse?.name || 'Privat'}</div>
                      <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
                        Kunde: {r.clients ? r.clients.last_name + ', ' + r.clients.first_name : '–'}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: COLORS.inkSoft }}>{r.abrechnungsart || '–'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: COLORS.ink, whiteSpace: 'nowrap' }}>{formatDate(r.issue_date)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: COLORS.ink, whiteSpace: 'nowrap' }}>{formatDate(r.due_date)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, color: COLORS.ink, whiteSpace: 'nowrap' }}>{formatCurrency(r.total)}</td>
                    <td style={{ padding: '12px 16px' }}><StatusBadge status={r.status} /></td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setPreviewItem(r)} style={{
                          padding: '5px 12px', borderRadius: 6, fontSize: 13,
                          border: '1px solid ' + COLORS.border, background: COLORS.surface,
                          color: COLORS.ink, cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>Ansehen</button>
                        {(r.status === 'offen' || r.status === 'überfällig') && (
                          <button onClick={() => updateStatus(r.id, 'bezahlt')} style={{
                            padding: '5px 12px', borderRadius: 6, fontSize: 13,
                            border: '1px solid transparent', background: 'transparent',
                            color: COLORS.success, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap',
                          }}>✓ Bezahlt</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div onClick={() => setModalOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: COLORS.surface, borderRadius: 12,
            width: '100%', maxWidth: 700, maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '20px 24px', borderBottom: '1px solid ' + COLORS.border, flexShrink: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: COLORS.ink }}>Neue Rechnung erstellen</h2>
              <button onClick={() => setModalOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: COLORS.muted, fontSize: 22,
              }}>×</button>
            </div>

            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Kunde <span style={{ color: COLORS.danger }}>*</span></label>
                <select name="client_id" value={form.client_id} onChange={handleFormChange} style={inputStyle}>
                  <option value="">Kunde auswählen...</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.last_name}, {c.first_name}</option>
                  ))}
                </select>
                {selectedClient && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: COLORS.primarySoft, borderRadius: 8, fontSize: 12, color: COLORS.primary }}>
                    ℹ️ Rechnungsempfänger: <strong>{selectedClient.krankenkassen?.name || 'Privatzahler (Kunde)'}</strong>
                    {selectedClient.versicherungsnummer && (
                      <> · Vers.-Nr.: <strong>{selectedClient.versicherungsnummer}</strong></>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Rechnungsdatum <span style={{ color: COLORS.danger }}>*</span></label>
                  <input type="date" name="issue_date" value={form.issue_date} onChange={handleFormChange} style={inputStyle} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Fälligkeitsdatum</label>
                  <input type="date" name="due_date" value={form.due_date} onChange={handleFormChange} style={inputStyle} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Leistungszeitraum von</label>
                  <input type="date" name="period_start" value={form.period_start} onChange={handleFormChange} style={inputStyle} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Leistungszeitraum bis</label>
                  <input type="date" name="period_end" value={form.period_end} onChange={handleFormChange} style={inputStyle} />
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Abrechnung</label>
                <div style={{ border: '1px solid ' + COLORS.border, borderRadius: 10, overflow: 'hidden', background: COLORS.surfaceAlt }}>
                  {ABRECHNUNGSARTEN.map((art) => (
                    <label key={art} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 16px', cursor: 'pointer',
                      borderBottom: art !== ABRECHNUNGSARTEN[ABRECHNUNGSARTEN.length - 1] ? '1px solid ' + COLORS.border : 'none',
                      background: form.abrechnungsart === art ? COLORS.primarySoft : 'transparent',
                    }}>
                      <input type="radio" name="abrechnungsart" value={art}
                        checked={form.abrechnungsart === art} onChange={handleFormChange}
                        style={{ accentColor: COLORS.primary, width: 16, height: 16 }} />
                      <span style={{ fontSize: 13, fontWeight: form.abrechnungsart === art ? 600 : 400,
                        color: form.abrechnungsart === art ? COLORS.primary : COLORS.ink }}>
                        {art}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Leistungspositionen</label>
                <div style={{ fontSize: 11, color: '#92400e', marginBottom: 6, background: '#fffbe6', padding: '8px 12px', borderRadius: 6, border: '1px solid #fde68a' }}>
                  💡 <strong>Tipp:</strong> Bei "Menge" können Sie z.B. "4 Stunden", "2,5 Std." oder "1 Pauschale" eingeben.
                </div>
                <div style={{ border: '1px solid ' + COLORS.border, borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '3fr 110px 100px 90px 32px', background: COLORS.surfaceAlt, borderBottom: '1px solid ' + COLORS.border }}>
                    {['Beschreibung', 'Menge', '€/Einh.', 'Gesamt', ''].map((h, i) => (
                      <div key={i} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: COLORS.muted }}>{h}</div>
                    ))}
                  </div>
                  {form.items.map((item, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 110px 100px 90px 32px',
                      borderBottom: i < form.items.length - 1 ? '1px solid ' + COLORS.border : 'none' }}>
                      <input value={item.description} onChange={e => handleItemChange(i, 'description', e.target.value)}
                        placeholder="z.B. Alltagsbegleitung" style={{ ...miniInput, borderRight: '1px solid ' + COLORS.border }} />
                      <input value={item.quantity} type="text" onChange={e => handleItemChange(i, 'quantity', e.target.value)}
                        placeholder="z.B. 4 Stunden" style={{ ...miniInput, borderRight: '1px solid ' + COLORS.border }} />
                      <input value={item.unit_price} type="number" step="0.01" min="0"
                        onChange={e => handleItemChange(i, 'unit_price', e.target.value)}
                        placeholder="0.00" style={{ ...miniInput, borderRight: '1px solid ' + COLORS.border }} />
                      <div style={{ padding: '9px 10px', fontSize: 13, fontWeight: 600, color: COLORS.ink, borderRight: '1px solid ' + COLORS.border, display: 'flex', alignItems: 'center' }}>
                        {item.total ? parseFloat(item.total).toFixed(2) + ' €' : '–'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {form.items.length > 1 && (
                          <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.danger, fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addItem} style={{ marginTop: 8, fontSize: 13, color: COLORS.primary, background: 'none', border: '1px dashed ' + COLORS.primary, borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}>
                  + Position hinzufügen
                </button>
              </div>

              <div style={{ background: COLORS.primarySoft, borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: COLORS.inkSoft }}>
                  <span>Zwischensumme</span><span>{formatCurrency(subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, color: COLORS.muted }}>
                  <span>MwSt. (§ 4 Nr. 16 UStG – steuerbefreit)</span><span>0,00 €</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: COLORS.ink, borderTop: '1px solid ' + COLORS.border, paddingTop: 10 }}>
                  <span>Gesamtbetrag</span><span style={{ color: COLORS.primary }}>{formatCurrency(total)}</span>
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Notizen</label>
                <textarea name="notes" value={form.notes} onChange={handleFormChange} rows={2}
                  placeholder="Interne Notizen..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid ' + COLORS.border, display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
              <button onClick={() => setModalOpen(false)} style={{ padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 500, border: '1px solid ' + COLORS.border, background: COLORS.surface, color: COLORS.ink, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={handleSave} disabled={saving || !form.client_id} style={{ padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 500, background: COLORS.primary, color: '#fff', border: '1px solid ' + COLORS.primary, cursor: saving || !form.client_id ? 'not-allowed' : 'pointer', opacity: saving || !form.client_id ? 0.6 : 1 }}>
                {saving ? 'Wird erstellt...' : 'Rechnung erstellen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewItem && (
        <InvoicePreview
          rechnung={previewItem}
          settings={settings}
          onClose={() => setPreviewItem(null)}
          onDeleted={() => { setPreviewItem(null); fetchAll(); }}
          onStatusChange={async (status) => {
            await updateStatus(previewItem.id, status);
            setPreviewItem(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Invoice Preview ──────────────────────────────────────────────────────────
function InvoicePreview({ rechnung, settings, onClose, onDeleted, onStatusChange }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const s = settings || {};
  const items = Array.isArray(rechnung.items) ? rechnung.items : [];
  const client = rechnung.clients || {};
  const kasse = client.krankenkassen;

  async function handleDelete() {
    setDeleting(true);
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', rechnung.id);
      if (error) throw error;
      onDeleted();
    } catch (e) {
      alert('Fehler beim Löschen: ' + e.message);
      setDeleting(false);
    }
  }

  function handlePrint() {
    const printContent = document.getElementById('invoice-print-area').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`
      <!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
      <title>Rechnung ${rechnung.number}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1f1d; padding: 40px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e8e3d8; }
        th { background: #f7f5f0; font-size: 11px; text-transform: uppercase; color: #8a9591; }
        @media print { body { padding: 20px; } }
      </style>
      </head><body>${printContent}</body></html>
    `);
    win.document.close();
    win.onload = () => { win.print(); };
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: COLORS.surface, borderRadius: 12,
          width: '100%', maxWidth: 680, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '20px 24px', borderBottom: '1px solid ' + COLORS.border, flexShrink: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: COLORS.ink }}>
              Rechnung {rechnung.number}
            </h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.muted, fontSize: 22 }}>×</button>
          </div>

          <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
            <div id="invoice-print-area">
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.primary }}>{s.name || 'Firma'}</div>
                <div style={{ fontSize: 12, color: COLORS.muted }}>{[s.street, s.city, s.phone].filter(Boolean).join(' · ')}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rechnungsempfänger</div>
                  {kasse ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 15, color: COLORS.ink }}>{kasse.name}</div>
                      {kasse.address && <div style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 2, whiteSpace: 'pre-line' }}>{kasse.address}</div>}
                      <div style={{ marginTop: 10, padding: '8px 10px', background: COLORS.surfaceAlt, borderRadius: 6, fontSize: 11 }}>
                        <div style={{ color: COLORS.muted, marginBottom: 2 }}>Versicherte/r:</div>
                        <div style={{ fontWeight: 600, color: COLORS.ink }}>{client.first_name} {client.last_name}</div>
                        {client.versicherungsnummer && <div style={{ color: COLORS.inkSoft, fontFamily: 'monospace', marginTop: 2 }}>Vers.-Nr.: {client.versicherungsnummer}</div>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 15, color: COLORS.ink }}>{client.first_name} {client.last_name}</div>
                      {client.address && <div style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>{client.address}</div>}
                      <div style={{ marginTop: 6, fontSize: 11, color: COLORS.muted, fontStyle: 'italic' }}>Privatzahler</div>
                    </>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rechnungsnummer</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: COLORS.ink }}>{rechnung.number}</div>
                  <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
                    Ausgestellt: {formatDate(rechnung.issue_date)}<br />
                    Fällig: {formatDate(rechnung.due_date)}
                  </div>
                </div>
              </div>

              {rechnung.abrechnungsart && (
                <div style={{ marginBottom: 20, padding: '10px 16px', background: COLORS.primarySoft, borderRadius: 8, borderLeft: '3px solid ' + COLORS.primary }}>
                  <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 2 }}>Abrechnung</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.primary }}>{rechnung.abrechnungsart}</div>
                </div>
              )}

              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
                <thead>
                  <tr style={{ background: COLORS.primarySoft }}>
                    {['Leistung', 'Menge', 'Einzelpreis', 'Gesamt'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: COLORS.primary, borderBottom: '2px solid ' + COLORS.primary }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid ' + COLORS.border }}>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: COLORS.ink }}>{it.description}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: COLORS.ink }}>{it.quantity || '—'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, color: COLORS.ink }}>{formatCurrency(it.unit_price)}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600, color: COLORS.ink }}>{formatCurrency(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
                <div style={{ minWidth: 260 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid ' + COLORS.ink, fontSize: 16, fontWeight: 700 }}>
                    <span>Gesamtbetrag</span>
                    <span style={{ color: COLORS.primary }}>{formatCurrency(rechnung.total)}</span>
                  </div>
                </div>
              </div>

              {s.iban && (
                <div style={{ background: COLORS.surfaceAlt, borderRadius: 8, padding: '12px 16px', fontSize: 12, color: COLORS.inkSoft, marginBottom: 12 }}>
                  <strong>Bankverbindung:</strong> {s.bank} · IBAN: {s.iban}{s.bic && ' · BIC: ' + s.bic}
                  <div style={{ marginTop: 4, color: COLORS.muted }}>Verwendungszweck: {rechnung.number}</div>
                </div>
              )}

              <div style={{ fontSize: 11, color: COLORS.muted, borderTop: '1px solid ' + COLORS.border, paddingTop: 12 }}>
                {s.invoice_footnote || 'Gemäß § 4 Nr. 16 UStG sind unsere Leistungen von der Umsatzsteuer befreit.'}
              </div>
            </div>
          </div>

          <div style={{ padding: '16px 24px', borderTop: '1px solid ' + COLORS.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(rechnung.status === 'offen' || rechnung.status === 'überfällig') && (
                <button onClick={() => onStatusChange('bezahlt')} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, border: '1px solid ' + COLORS.success, background: 'transparent', color: COLORS.success, cursor: 'pointer' }}>
                  ✓ Als bezahlt markieren
                </button>
              )}
              {rechnung.status !== 'storniert' && (
                <button onClick={() => onStatusChange('storniert')} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, border: '1px solid transparent', background: 'transparent', color: COLORS.danger, cursor: 'pointer' }}>
                  Stornieren
                </button>
              )}
              <button onClick={() => setConfirmDelete(true)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, border: '1px solid ' + COLORS.danger, background: 'transparent', color: COLORS.danger, cursor: 'pointer', fontWeight: 500 }}>
                🗑️ Löschen
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handlePrint} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, border: '1px solid ' + COLORS.border, background: COLORS.surface, color: COLORS.ink, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                🖨️ Drucken
              </button>
              <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, fontSize: 14, border: '1px solid ' + COLORS.border, background: COLORS.surface, color: COLORS.ink, cursor: 'pointer' }}>
                Schließen
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm Delete Dialog */}
      {confirmDelete && (
        <ConfirmDialog
          message={'Rechnung "' + rechnung.number + '" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.'}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

const labelStyle = { display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: COLORS.inkSoft };
const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid ' + COLORS.border, borderRadius: 8, fontSize: 14, color: COLORS.ink, background: COLORS.surface, outline: 'none', boxSizing: 'border-box' };
const miniInput = { width: '100%', padding: '9px 10px', border: 'none', outline: 'none', fontSize: 13, color: COLORS.ink, background: 'transparent', boxSizing: 'border-box' };