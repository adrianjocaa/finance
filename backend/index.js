const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const secret = 'seu_segredo_aqui';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: '9453',
  database: 'controle_gastos'
});

db.connect((err) => {
  if (err) {
    console.error('Erro ao conectar no MySQL:', err);
    return;
  }
  console.log('Conectado ao MySQL');
});

const criarTabelas = () => {
  const usuarios = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE,
      email VARCHAR(320) UNIQUE, 
      password VARCHAR(255)
    )`;

  const gastos = `
    CREATE TABLE IF NOT EXISTS gastos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT,
      descricao VARCHAR(255),
      valor DECIMAL(10,2),
      valor_pago DECIMAL(10,2) DEFAULT 0,
      status ENUM('pendente', 'pago', 'parcialmente pago') DEFAULT 'pendente',
      data DATE,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )`;

  db.query(usuarios, (err) => {
      if (err) console.error('Erro ao criar tabela usuarios:', err);
      else console.log('Tabela usuarios verificada/criada.');
  });
  db.query(gastos, (err) => {
      if (err) console.error('Erro ao criar tabela gastos:', err);
      else console.log('Tabela gastos verificada/criada.');
  });
};

criarTabelas();

const autenticarToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, secret, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    db.query('INSERT INTO usuarios (username, email, password) VALUES (?, ?, ?)',
      [name, email, hash],
      (err) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email ou nome de usuário já existe.' });
          }
          return res.status(500).json({ error: 'Erro no cadastro. Tente novamente.' });
        }
        res.json({ message: 'Usuário registrado com sucesso!' });
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
  }

  const queryParams = [username, username];
  db.query('SELECT * FROM usuarios WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', queryParams, async (err, results) => { 
    if (err || results.length === 0) {
      return res.status(400).json({ error: 'Usuário não encontrado ou senha incorreta.' });
    }
    const user = results[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Usuário não encontrado ou senha incorreta.' });
    }
    const token = jwt.sign({ id: user.id }, secret, { expiresIn: '1d' });
    res.json({ token });
  });
});

app.get('/gastos', autenticarToken, (req, res) => {
  db.query('SELECT * FROM gastos WHERE usuario_id = ? ORDER BY data DESC', [req.user.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar gastos' });
    res.json(results);
  });
});

app.post('/gastos', autenticarToken, (req, res) => {
  const { descricao, valor, dia, mes, ano } = req.body; 
  
  if (!descricao || isNaN(valor) || valor <= 0 || !dia || !mes || !ano) {
    return res.status(400).json({ error: 'Por favor, forneça uma descrição, valor, dia, mês e ano válidos para o gasto.' });
  }

  const dataGasto = new Date(ano, mes - 1, dia).toISOString().split('T')[0]; 

  db.query('INSERT INTO gastos (usuario_id, descricao, valor, data) VALUES (?, ?, ?, ?)',
    [req.user.id, descricao, valor, dataGasto],
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao adicionar gasto' });
      }
      res.status(201).json({ id: result.insertId, descricao, valor, data: dataGasto, valor_pago: 0, status: 'pendente' });
    });
});

app.put('/gastos/pagar/:id', autenticarToken, (req, res) => {
    const { id } = req.params;
    const { valor_pagamento } = req.body;

    if (isNaN(valor_pagamento) || valor_pagamento <= 0) {
        return res.status(400).json({ error: 'O valor do pagamento deve ser um número positivo.' });
    }

    db.query('SELECT valor, valor_pago FROM gastos WHERE id = ? AND usuario_id = ?', [id, req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Erro ao buscar gasto.' });
        if (results.length === 0) return res.status(404).json({ error: 'Gasto não encontrado ou não pertence ao usuário.' });

        const gasto = results[0];
        const saldoRestante = gasto.valor - gasto.valor_pago;

        if (valor_pagamento > saldoRestante) {
            return res.status(400).json({ error: `O valor do pagamento excede o saldo restante de R$ ${saldoRestante.toFixed(2)}.` });
        }

        const novoValorPago = parseFloat(gasto.valor_pago) + parseFloat(valor_pagamento);
        let novoStatus = 'parcialmente pago';
        if (novoValorPago >= gasto.valor) {
            novoStatus = 'pago';
        }

        db.query('UPDATE gastos SET valor_pago = ?, status = ? WHERE id = ?', [novoValorPago, novoStatus, id], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao registrar pagamento.' });
            res.json({ message: 'Pagamento registrado com sucesso.', status: novoStatus, valor_pago: novoValorPago });
        });
    });
});

// NOVA ROTA: Deleta um gasto específico
app.delete('/gastos/:id', autenticarToken, (req, res) => {
  const gastoId = req.params.id;
  const userId = req.user.id;

  db.query('DELETE FROM gastos WHERE id = ? AND usuario_id = ?', [gastoId, userId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao deletar o gasto.' });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Gasto não encontrado ou não pertence a este usuário.' });
    }
    res.json({ message: 'Gasto deletado com sucesso.' });
  });
});

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});