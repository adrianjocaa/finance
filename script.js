const form = document.getElementById('gastoForm');
const listaGastos = document.getElementById('listaGastos');
const totalGastos = document.getElementById('totalGastos');

let gastos = [];

form.addEventListener('submit', function(e) {
  e.preventDefault();

  const descricao = document.getElementById('descricao').value.trim();
  const valor = parseFloat(document.getElementById('valor').value);

  if (!descricao || isNaN(valor) || valor <= 0) {
    alert('Por favor, insira uma descrição válida e valor maior que zero.');
    return;
  }

  gastos.push({ descricao, valor });

  atualizarLista();
  atualizarTotal();

  form.reset();
});

function atualizarLista() {
  listaGastos.innerHTML = '';
  gastos.forEach((gasto) => {
    const li = document.createElement('li');
    li.textContent = `${gasto.descricao}`;
    const spanValor = document.createElement('span');
    spanValor.textContent = `R$ ${gasto.valor.toFixed(2).replace('.', ',')}`;
    li.appendChild(spanValor);
    listaGastos.appendChild(li);
  });
}

function atualizarTotal() {
  const soma = gastos.reduce((acc, gasto) => acc + gasto.valor, 0);
  totalGastos.textContent = `Total: R$ ${soma.toFixed(2).replace('.', ',')}`;
}
