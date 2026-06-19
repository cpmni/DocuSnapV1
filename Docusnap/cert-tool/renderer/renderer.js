'use strict';

const api = window.certtool;
const $ = (id) => document.getElementById(id);

$('browse').addEventListener('click', async () => {
  const d = await api.pickOutDir();
  if (d) $('outdir').value = d;
});

$('go').addEventListener('click', async () => {
  const customer  = $('customer').value.trim();
  const addresses = $('addresses').value.trim();
  const outDir    = $('outdir').value.trim();
  const days      = parseInt($('days').value, 10) || 825;
  const reuseCa   = $('reuse').checked;

  if (!customer)  return showErr('Enter a customer name.');
  if (!addresses) return showErr('Enter at least one server address (IP or hostname).');
  if (!outDir)    return showErr('Choose an output folder.');

  const btn = $('go');
  btn.disabled = true; btn.textContent = 'Generating…';
  const r = await api.generate({ customer, addresses, outDir, days, reuseCa });
  btn.disabled = false; btn.textContent = 'Generate certificates';

  if (!r.ok) return showErr(r.error || 'Generation failed.');
  showResult(r.result);
});

function showErr(msg) {
  const out = $('out'); out.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'result err';
  d.innerHTML = '<h2>Could not generate</h2><div class="err-msg"></div>';
  d.querySelector('.err-msg').textContent = msg;
  out.appendChild(d);
}

function showResult(res) {
  const out = $('out'); out.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'result';
  const caNote = res.caReused
    ? '<p class="ca-note reuse">Reused the existing CA — clients already pinned to <code>ca.crt</code> keep working.</p>'
    : '<p class="ca-note new">New CA created — give <code>ca.crt</code> to this customer’s clients.</p>';
  wrap.innerHTML =
    '<h2>Certificates ready</h2>' +
    '<div class="dir"></div>' +
    caNote +
    '<ul class="deliver">' +
      '<li><span class="file">server.crt + server.key</span><span class="where">Core app <small>→ Settings → Licensing → Search client access → TLS cert / key</small></span></li>' +
      '<li><span class="file">ca.crt</span><span class="where">Each client <small>→ Connect screen → Choose .crt</small></span></li>' +
      '<li><span class="file keep">ca.key</span><span class="where keep">Keep private (vendor) <small>— re-issue/rotate the server cert without re-pinning clients</small></span></li>' +
    '</ul>' +
    '<div class="act"><button class="btn" id="openf">Open folder</button><button class="btn" id="again">Generate another</button></div>';
  wrap.querySelector('.dir').textContent = res.dir + '   (SANs: ' + res.sans.join(', ') + ')';
  out.appendChild(wrap);
  $('openf').addEventListener('click', () => api.openFolder(res.dir));
  $('again').addEventListener('click', () => { out.innerHTML = ''; $('customer').focus(); });
}
