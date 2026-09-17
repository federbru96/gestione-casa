import React, { useState, useEffect } from 'react';
import { Calendar, Download, Zap, Upload, Paperclip, User, Lock } from 'lucide-react';
import jsPDF from 'jspdf';
import { supabase } from './supabaseClient'; 

export default function App() {
  const [contract, setContract] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'owner' | 'tenant'>('tenant');
  
  const [showPinModal, setShowPinModal] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const CORRECT_PIN = "021296";

  const [billForm, setBillForm] = useState({
    type: "Luce",
    billAmount: "",
    tenantShare: "",
    selectedMonthId: "",
    fileName: null as string | null
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const { data: tenantData, error: tErr } = await supabase.from('tenants').select('*').eq('id', 1).maybeSingle();
      if (tErr) throw tErr;
      if (tenantData) setContract(tenantData);

      const { data: paymentsData, error: pErr } = await supabase
        .from('payments')
        .select('*, bills(*)')
        .order('id');
        
      if (pErr) throw pErr;
      if (paymentsData) setPayments(paymentsData);
      
    } catch (err: any) {
      console.error("Errore dettagliato:", err);
      setErrorMsg(err.message || JSON.stringify(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setBillForm({ ...billForm, fileName: file.name });
  };

  const handleApplyUtility = async (e: React.FormEvent) => {
    e.preventDefault();
    const share = parseFloat(billForm.tenantShare);
    const monthId = Number(billForm.selectedMonthId);
    if (isNaN(share) || share <= 0 || !monthId) {
      alert("Inserisci un importo valido e seleziona un mese.");
      return;
    }

    const paymentToUpdate = payments.find(p => p.id === monthId);
    if (!paymentToUpdate) return;

    let publicUrl = "";
    const fileInput = (document.getElementById('pdf-file-input') as HTMLInputElement)?.files?.[0];

    if (fileInput) {
      const fileName = `bolletta_${monthId}_${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('bollette')
        .upload(fileName, fileInput);

      if (uploadError) {
        alert("Errore durante il caricamento del file PDF: " + uploadError.message);
        return;
      }

      const { data: publicURLData } = supabase.storage
        .from('bollette')
        .getPublicUrl(fileName);

      publicUrl = publicURLData.publicUrl;
    }

    const newUtility = Number(paymentToUpdate.utility_amount || 0) + share;
    const newTotal = Number(paymentToUpdate.rent_amount) + newUtility;

    const { error: billError } = await supabase.from('bills').insert([
      {
        payment_id: monthId,
        utility_type: billForm.type,
        total_bill_amount: parseFloat(billForm.billAmount) || share,
        tenant_share: share,
        file_url: publicUrl
      }
    ]);

    if (billError) {
      alert("Errore nel salvataggio della bolletta: " + billError.message);
      return;
    }

    const { error: paymentError } = await supabase
      .from('payments')
      .update({ 
        utility_amount: newUtility, 
        total: newTotal
      })
      .eq('id', monthId);

    if (!paymentError) {
      alert("Documento caricato e aggiunto con successo!");
      fetchData();
      setBillForm({ type: "Luce", billAmount: "", tenantShare: "", selectedMonthId: "", fileName: null });
      const fileInputEl = document.getElementById('pdf-file-input') as HTMLInputElement;
      if (fileInputEl) fileInputEl.value = "";
    } else {
      alert("Errore nell'aggiornamento del pagamento: " + paymentError.message);
    }
  };

  const togglePaymentStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "Pagato" ? "In attesa" : "Pagato";
    const payDate = newStatus === "Pagato" ? new Date().toISOString().split('T')[0] : null;

    const { error } = await supabase
      .from('payments')
      .update({ status: newStatus, pay_date: payDate })
      .eq('id', id);

    if (!error) fetchData();
  };

  const generatePDF = (payment: any) => {
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text("RICEVUTA DI PAGAMENTO", 105, 20, { align: "center" });
    doc.setFontSize(10);
    doc.text(`Ricevuta N°: RICEV-${payment.id}/2026`, 20, 35);
    doc.text(`Data Emissione: ${new Date().toLocaleDateString('it-IT')}`, 140, 35);

    doc.line(20, 40, 190, 40);
    doc.text(`Immobile: ${contract?.address}`, 20, 50);
    doc.text(`Inquilino: ${contract?.tenant_name} (${contract?.tenant_cf})`, 20, 58);
    doc.text(`Riferimento Mese: ${payment.month}`, 20, 66);

    doc.line(20, 75, 190, 75);
    doc.text("Descrizione", 20, 83);
    doc.text("Importo (€)", 160, 83);
    doc.line(20, 87, 190, 87);

    doc.text("Canone di locazione (Contratto Transitorio)", 20, 97);
    doc.text(`${Number(payment.rent_amount).toFixed(2)} €`, 160, 97);

    let currentY = 107;

    if (payment.bills && payment.bills.length > 0) {
      payment.bills.forEach((bill: any) => {
        doc.text(`Utenza ${bill.utility_type}`, 20, currentY);
        doc.text(`${Number(bill.tenant_share).toFixed(2)} €`, 160, currentY);
        currentY += 10;
      });
    } else {
      doc.text("Rimborso Spese Utenze / Documenti", 20, currentY);
      doc.text(`${Number(payment.utility_amount || 0).toFixed(2)} €`, 160, currentY);
      currentY += 10;
    }

    doc.line(20, currentY + 5, 190, currentY + 5);
    doc.setFontSize(12);
    doc.text("TOTALE RICEVUTO:", 20, currentY + 15);
    doc.text(`${Number(payment.total).toFixed(2)} €`, 160, currentY + 15);

    doc.setFontSize(9);
    doc.text("Pagamento effettuato a mezzo bonifico bancario.", 20, currentY + 35);
    doc.text("Imposta di bollo da 2,00€ assolta sull'originale se dovuta.", 20, currentY + 42);

    doc.save(`Ricevuta_${contract?.tenant_name.replace(" ", "_")}_${payment.month.replace(" ", "_")}.pdf`);
  };

  const handleVerifyPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (enteredPin === CORRECT_PIN) {
      setViewMode('owner');
      setShowPinModal(false);
      setEnteredPin("");
    } else {
      alert("Codice PIN errato!");
      setEnteredPin("");
    }
  };

  if (errorMsg) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', backgroundColor: '#fff5f5', color: '#c53030', minHeight: '100vh' }}>
        <h2>Errore di connessione a Supabase:</h2>
        <p style={{ fontWeight: 'bold' }}>{errorMsg}</p>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Caricamento dati dal database in corso... ⏳</div>;
  }

  return (
    <div style={{ fontFamily: 'sans-serif', backgroundColor: '#f4f6f8', minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', backgroundColor: 'white', padding: '16px 20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div>
            <h1 style={{ fontSize: '22px', margin: 0, color: '#1a202c' }}>
              {viewMode === 'owner' ? 'Gestione Affitto Transitorio (Proprietario)' : 'Area Personale Inquilino'}
            </h1>
            <p style={{ color: '#718096', margin: '4px 0 0 0', fontSize: '14px' }}>{contract?.address} — {contract?.tenant_name}</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {viewMode === 'owner' ? (
              <button 
                onClick={() => setViewMode('tenant')}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#319795', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
              >
                <User size={16} /> Torna a Vista Inquilino
              </button>
            ) : (
              <button 
                onClick={() => setShowPinModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#2d3748', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
              >
                <Lock size={16} /> Accesso Proprietario (PIN)
              </button>
            )}
          </div>
        </header>

        {showPinModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
            <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '8px', width: '320px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <Lock color="#2d3748" size={20} />
                <h3 style={{ margin: 0, fontSize: '18px' }}>Inserisci PIN Riservato</h3>
              </div>
              <form onSubmit={handleVerifyPin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input 
                  type="password" 
                  placeholder="PIN (es. 1234)"
                  value={enteredPin}
                  onChange={e => setEnteredPin(e.target.value)}
                  autoFocus
                  style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e0', fontSize: '16px', textAlign: 'center', letterSpacing: '4px' }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button type="submit" style={{ flex: 1, backgroundColor: '#3182ce', color: 'white', border: 'none', padding: '8px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Sblocca
                  </button>
                  <button type="button" onClick={() => { setShowPinModal(false); setEnteredPin(""); }} style={{ flex: 1, backgroundColor: '#edf2f7', color: '#4a5568', border: 'none', padding: '8px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Annulla
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {viewMode === 'owner' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
              
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Calendar color="#3182ce" size={20} />
                  <h2 style={{ fontSize: '18px', margin: 0 }}>Prossima Scadenza Canone</h2>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: '28px', fontWeight: 'bold', margin: 0, color: '#2d3748' }}>€ {contract?.monthly_rent}</p>
                    <p style={{ color: '#718096', margin: '4px 0 0 0', fontSize: '14px' }}>Scadenza: il {contract?.due_day} del mese</p>
                  </div>
                  <span style={{ backgroundColor: '#feebc8', color: '#744210', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                    Promemoria Attivo
                  </span>
                </div>
              </div>

              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Zap color="#d69e2e" size={20} />
                  <h2 style={{ fontSize: '18px', margin: 0 }}>Carica Nuova Bolletta / Documento PDF</h2>
                </div>
                
                <form onSubmit={handleApplyUtility} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '12px', color: '#4a5568' }}>Tipo Utenza / Voce</label>
                      <select 
                        value={billForm.type} 
                        onChange={e => setBillForm({ ...billForm, type: e.target.value })}
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e0' }}
                      >
                        <option value="Luce">Luce</option>
                        <option value="Gas">Gas</option>
                        <option value="Acqua">Acqua</option>
                        <option value="Internet">Internet</option>
                        <option value="TARI">TARI</option>
                        <option value="Assicurazione Casa">Assicurazione Casa</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '12px', color: '#4a5568' }}>Mese di Riferimento</label>
                      <select 
                        value={billForm.selectedMonthId} 
                        onChange={e => setBillForm({ ...billForm, selectedMonthId: e.target.value })}
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e0' }}
                      >
                        <option value="">Seleziona mese...</option>
                        {payments.map(p => (
                          <option key={p.id} value={p.id}>{p.month}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '12px', color: '#4a5568' }}>Totale Documento (€)</label>
                      <input 
                        type="number" 
                        step="0.01" 
                        placeholder="es. 150.00"
                        value={billForm.billAmount} 
                        onChange={e => setBillForm({ ...billForm, billAmount: e.target.value })} 
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e0' }} 
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', color: '#4a5568' }}>Quota Inquilino (€)</label>
                      <input 
                        type="number" 
                        step="0.01" 
                        placeholder="es. 75.00"
                        value={billForm.tenantShare} 
                        onChange={e => setBillForm({ ...billForm, tenantShare: e.target.value })} 
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e0' }} 
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#edf2f7', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', border: '1px dashed #cbd5e0' }}>
                      <Upload size={14} /> Allega PDF
                      <input id="pdf-file-input" type="file" accept=".pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
                    </label>
                    <span style={{ fontSize: '12px', color: '#718096', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                      {billForm.fileName || "Nessun file"}
                    </span>
                  </div>

                  <button type="submit" style={{ backgroundColor: '#3182ce', color: 'white', border: 'none', padding: '8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginTop: '4px' }}>
                    Salva nel Database
                  </button>
                </form>
              </div>

            </div>

            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h2 style={{ fontSize: '18px', margin: '0 0 16px 0' }}>Registro Pagamenti, Bollette & Ricevute (Gestione)</h2>

              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #edf2f7', color: '#718096', fontSize: '14px' }}>
                    <th style={{ padding: '12px 8px' }}>Mese</th>
                    <th style={{ padding: '12px 8px' }}>Canone</th>
                    <th style={{ padding: '12px 8px' }}>Utenze</th>
                    <th style={{ padding: '12px 8px' }}>Allegato</th>
                    <th style={{ padding: '12px 8px' }}>Totale</th>
                    <th style={{ padding: '12px 8px' }}>Stato</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Azione / Ricevuta</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #edf2f7', fontSize: '14px' }}>
                      <td style={{ padding: '12px 8px', fontWeight: '500' }}>{p.month}</td>
                      <td style={{ padding: '12px 8px' }}>€ {p.rent_amount}</td>
                      <td style={{ padding: '12px 8px' }}>€ {p.utility_amount}</td>
                      <td style={{ padding: '12px 8px' }}>
                        {((p.bills && p.bills.length > 0) || p.utility_file_url) ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {p.bills && p.bills.map((b: any, idx: number) => (
                              <a 
                                key={idx}
                                href={b.file_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#2b6cb0', textDecoration: 'none' }}
                              >
                                <Paperclip size={12} /> {b.utility_type} (€ {b.tenant_share})
                              </a>
                            ))}
                            {p.utility_file_url && (!p.bills || !p.bills.some((b: any) => b.file_url === p.utility_file_url)) && (
                              <a 
                                href={p.utility_file_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#2b6cb0', textDecoration: 'none' }}
                              >
                                <Paperclip size={12} /> Documento Precedente
                              </a>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#a0aec0', fontSize: '12px' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>€ {p.total}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span 
                          onClick={() => togglePaymentStatus(p.id, p.status)}
                          style={{ 
                            cursor: 'pointer',
                            padding: '4px 8px', 
                            borderRadius: '12px', 
                            fontSize: '12px',
                            backgroundColor: p.status === 'Pagato' ? '#c6f6d5' : '#feebc8',
                            color: p.status === 'Pagato' ? '#22543d' : '#744210'
                          }}
                        >
                          {p.status} (Clicca per invertire)
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        {p.status === 'Pagato' ? (
                          <button 
                            onClick={() => generatePDF(p)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: '#edf2f7', color: '#2d3748', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            <Download size={14} /> PDF Ricevuta
                          </button>
                        ) : (
                          <span style={{ color: '#a0aec0', fontSize: '12px' }}>In attesa di saldo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {viewMode === 'tenant' && (
          <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #edf2f7', paddingBottom: '12px' }}>
              <User color="#319795" size={24} />
              <div>
                <h2 style={{ fontSize: '18px', margin: 0, color: '#2d3748' }}>Benvenuta, {contract?.tenant_name}</h2>
                <p style={{ color: '#718096', margin: '2px 0 0 0', fontSize: '13px' }}>Ecco il riepilogo dei tuoi pagamenti e delle ricevute ufficiali.</p>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #edf2f7', color: '#718096', fontSize: '14px' }}>
                  <th style={{ padding: '12px 8px' }}>Mese</th>
                  <th style={{ padding: '12px 8px' }}>Canone</th>
                  <th style={{ padding: '12px 8px' }}>Utenze / Extra</th>
                  <th style={{ padding: '12px 8px' }}>Documento</th>
                  <th style={{ padding: '12px 8px' }}>Totale</th>
                  <th style={{ padding: '12px 8px' }}>Stato Pagamento</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right' }}>Scarica Ricevuta</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #edf2f7', fontSize: '14px' }}>
                    <td style={{ padding: '14px 8px', fontWeight: '500' }}>{p.month}</td>
                    <td style={{ padding: '14px 8px' }}>€ {p.rent_amount}</td>
                    <td style={{ padding: '14px 8px' }}>{p.utility_amount > 0 ? `€ ${p.utility_amount}` : '—'}</td>
                    
                    <td style={{ padding: '14px 8px' }}>
                      {((p.bills && p.bills.length > 0) || p.utility_file_url) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {p.bills && p.bills.map((b: any, idx: number) => (
                            <a 
                              key={idx}
                              href={b.file_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              style={{ color: '#3182ce', textDecoration: 'none', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '500' }}
                            >
                              <Paperclip size={14} /> {b.utility_type} (€ {b.tenant_share})
                            </a>
                          ))}
                          {p.utility_file_url && (!p.bills || !p.bills.some((b: any) => b.file_url === p.utility_file_url)) && (
                            <a 
                              href={p.utility_file_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              style={{ color: '#3182ce', textDecoration: 'none', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '500' }}
                            >
                              <Paperclip size={14} /> Documento Precedente
                            </a>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#a0aec0', fontSize: '12px' }}>—</span>
                      )}
                    </td>

                    <td style={{ padding: '14px 8px', fontWeight: 'bold' }}>€ {p.total}</td>
                    <td style={{ padding: '14px 8px' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', backgroundColor: p.status === 'Pagato' ? '#c6f6d5' : '#feebc8', color: p.status === 'Pagato' ? '#22543d' : '#744210' }}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                      {p.status === 'Pagato' ? (
                        <button 
                          onClick={() => generatePDF(p)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#319795', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', fontSize: '12px' }}
                        >
                          <Download size={14} /> Scarica Ricevuta PDF
                        </button>
                      ) : (
                        <span style={{ color: '#a0aec0', fontSize: '12px', fontStyle: 'italic' }}>Disponibile dopo il saldo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: '30px', borderTop: '1px solid #edf2f7', paddingTop: '20px' }}>
              <h3 style={{ fontSize: '16px', margin: '0 0 12px 0', color: '#2d3748', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Paperclip size={18} /> Documenti dell'Immobile
              </h3>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <a 
                  href="https://vwsvfyneyziytdmxkxgi.supabase.co/storage/v1/object/public/documenti-immobile/APE%20SIGLATA.pdf" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ backgroundColor: '#edf2f7', padding: '8px 14px', borderRadius: '6px', textDecoration: 'none', color: '#2b6cb0', fontSize: '13px', fontWeight: '500', border: '1px solid #e2e8f0' }}
                >
                  📄 Visualizza APE
                </a>
                <a 
                  href="https://vwsvfyneyziytdmxkxgi.supabase.co/storage/v1/object/public/documenti-immobile/VISURA%20CATASTALE.pdf" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ backgroundColor: '#edf2f7', padding: '8px 14px', borderRadius: '6px', textDecoration: 'none', color: '#2b6cb0', fontSize: '13px', fontWeight: '500', border: '1px solid #e2e8f0' }}
                >
                  📄 Visualizza Visura Catastale
                </a>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}