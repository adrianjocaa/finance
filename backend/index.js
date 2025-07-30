const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const secret = 'seu_segredo_aqui'; // Mantenha este segredo seguro e em um ambiente de produção use variáveis de ambiente!

// Middlewares
app.use(cors()); // Permite requisições de diferentes origens (importante para o frontend)
app.use(bodyParser.json()); // Habilita o parsing de JSON no corpo das requisições
app.use(express.static(path.join(__dirname, 'public'))); // Serve arquivos estáticos do diretório 'public'

// Conexão com MySQL
const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: '9453', // Sua senha do MySQL
  database: 'controle_gastos' // O nome do seu banco de dados
});

// Testa a conexão com o banco de dados
db.connect((err) => {
  if (err) {
    console.error('Erro ao conectar no MySQL:', err);
    return;
  }
  console.log('Conectado ao MySQL');
});

// Função para criar tabelas se não existirem
const criarTabelas = () => {
  // Tabela de usuários: corrigido 'VANCHAR' para 'VARCHAR'
  const usuarios = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE,
      email VARCHAR(320) UNIQUE, 
      password VARCHAR(255)
    )`;

  // Tabela de gastos: adicionada coluna 'data' para consistência com o frontend
  const gastos = `
    CREATE TABLE IF NOT EXISTS gastos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT,
      descricao VARCHAR(255),
      valor DECIMAL(10,2),
      data DATE, -- Adicionado: Coluna para a data do gasto
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )`;

  // Executa as queries para criar as tabelas
  db.query(usuarios, (err) => {
      if (err) console.error('Erro ao criar tabela usuarios:', err);
      else console.log('Tabela usuarios verificada/criada.');
  });
  db.query(gastos, (err) => {
      if (err) console.error('Erro ao criar tabela gastos:', err);
      else console.log('Tabela gastos verificada/criada.');
  });
};

criarTabelas(); // Chama a função para criar as tabelas ao iniciar o servidor

// Middleware de autenticação JWT
const autenticarToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1]; // Obtém o token do cabeçalho Authorization
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, secret, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user; // Anexa as informações do usuário ao objeto de requisição
    next(); // Continua para a próxima função middleware/rota
  });
};

// Rota de Registro de Usuário
app.post('/register', async (req, res) => {
  // Desestrutura os dados do corpo da requisição
  const { name, email, password } = req.body; // 'name' do frontend será o 'username' no banco de dados
  
  // Validação básica dos campos
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
  }

  try {
    // Gera o hash da senha antes de armazenar
    const hash = await bcrypt.hash(password, 10);

    // Insere o novo usuário no banco de dados
    db.query('INSERT INTO usuarios (username, email, password) VALUES (?, ?, ?)',
      [name, email, hash], // Mapeia 'name' para 'username', e passa email e hash da senha
      (err) => {
        if (err) {
          console.error("Erro ao registrar usuário no banco de dados:", err); // Log detalhado do erro
          // Verifica se o erro é devido a uma entrada duplicada (username ou email)
          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email ou nome de usuário já existe.' });
          }
          return res.status(500).json({ error: 'Erro no cadastro. Tente novamente.' });
        }
        console.log(`Usuário "${name}" registrado com sucesso.`); // Log para confirmar o username registrado
        res.json({ message: 'Usuário registrado com sucesso!' });
    });
  } catch (error) {
    console.error("Erro ao gerar hash da senha:", error);
    return res.status(500).json({ error: 'Erro interno do servidor durante o cadastro.' });
  }
});

// Rota de Login de Usuário
app.post('/login', (req, res) => {
  const { username, password } = req.body; // O frontend envia 'username' para login
  
  console.log('--- Requisição de Login Recebida ---');
  console.log('  Username/Email recebido (do frontend):', username);
  console.log('  Password recebido (do frontend - NÃO LOGAR SENHAS EM PRODUÇÃO!):', password); 

  // Validação básica dos campos
  if (!username || !password) {
    console.log('Campos de login vazios. Retornando 400 Bad Request.');
    return res.status(400).json({ error: 'Por favor, preencha todos os campos.' });
  }

  // Prepara os parâmetros para a consulta SQL.
  // O valor 'username' do frontend será usado para comparar tanto com a coluna 'username' quanto com a coluna 'email'.
  const queryParams = [username, username];
  console.log('Parâmetros da consulta SQL para busca de usuário:', queryParams); // Log dos parâmetros

  // Busca o usuário pelo username OU email, convertendo ambos para minúsculas para comparação insensível a maiúsculas/minúsculas
  db.query('SELECT * FROM usuarios WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', queryParams, async (err, results) => { 
    if (err) {
      console.error("Erro ao buscar usuário para login no banco de dados:", err);
      return res.status(500).json({ error: 'Erro no servidor ao tentar login.' });
    }
    
    console.log('Resultados da consulta de usuário no DB:', results);

    if (results.length === 0) {
      console.log('Usuário não encontrado no banco de dados para username/email:', username);
      return res.status(400).json({ error: 'Usuário não encontrado.' });
    }

    const user = results[0];
    console.log('Usuário encontrado no DB:', user); // Log do objeto de usuário completo

    // Verificação crítica: Garante que user.password existe antes de tentar comparar
    if (!user.password) {
        console.error('Erro: Senha do usuário é nula ou indefinida no banco de dados para o usuário:', username);
        return res.status(500).json({ error: 'Erro interno do servidor: Senha não encontrada para o usuário.' });
    }

    try {
        // Compara a senha fornecida com o hash armazenado
        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
          console.log('Senha incorreta para o usuário:', username);
          return res.status(401).json({ error: 'Senha incorreta.' });
        }

        // Gera um token JWT para o usuário autenticado
        const token = jwt.sign({ id: user.id }, secret, { expiresIn: '1d' });
        console.log('Login bem-sucedido para usuário:', username);
        res.json({ token });
    } catch (bcryptError) {
        console.error("Erro ao comparar senhas com bcrypt:", bcryptError);
        return res.status(500).json({ error: 'Erro interno do servidor ao verificar a senha.' });
    }
  });
});

// Rota para somar contas a pagar
app.get('/total-pagar', autenticarToken, (req, res) => {
  db.query(
    'SELECT SUM(valor - valor_pago) AS total FROM gastos WHERE usuario_id = ? AND tipo = "pagar"',
    [req.user.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Erro' });
      res.json({ total: result[0].total || 0 });
    }
  );
});

// Rota para somar contas a receber
app.get('/proximas-receber', autenticarToken, (req, res) => {
  db.query(
    'SELECT * FROM gastos WHERE usuario_id = ? AND tipo = "receber" AND data >= CURDATE() ORDER BY data ASC',
    [req.user.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: 'Erro' });
      res.json(results);
    }
  );
});

// Rota para listar próximas contas a pagar
app.get('/proximas-pagar', autenticarToken, (req, res) => {
  db.query(
    'SELECT * FROM gastos WHERE usuario_id = ? AND tipo = "pagar" AND data >= CURDATE() ORDER BY data ASC',
    [req.user.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: 'Erro' });
      res.json(results);
    }
  );
});

// Rota para listar próximas contas a receber
app.get('/proximas-receber', autenticarToken, (req, res) => {
  db.query(
    'SELECT * FROM gastos WHERE usuario_id = ? AND tipo = "receber" AND data >= CURDATE() ORDER BY data ASC',
    [req.user.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: 'Erro' });
      res.json(results);
    }
  );
});

// Rota para buscar todos os gastos de um usuário
app.get('/gastos', autenticarToken, (req, res) => {
  db.query('SELECT * FROM gastos WHERE usuario_id = ?', [req.user.id], (err, results) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar gastos' });
    res.json(results);
  });
});

// Rota para adicionar um novo gasto
app.post('/gastos', autenticarToken, (req, res) => {
  const { descricao, valor, mes, ano } = req.body; 
  
  // Validação básica dos campos
  if (!descricao || isNaN(valor) || valor <= 0 || !mes || !ano) {
    return res.status(400).json({ error: 'Por favor, forneça uma descrição, valor, mês e ano válidos para o gasto.' });
  }

  // Cria uma data no formato ISO (YYYY-MM-DD) para o banco de dados
  // Nota: mes é 1-12, mas Date() usa 0-11 para o mês
  const dataGasto = new Date(ano, mes - 1, 1).toISOString().split('T')[0]; 

  db.query('INSERT INTO gastos (usuario_id, descricao, valor, data) VALUES (?, ?, ?, ?)',
    [req.user.id, descricao, valor, dataGasto],
    (err, result) => {
      if (err) {
        console.error("Erro ao adicionar gasto no banco de dados:", err);
        return res.status(500).json({ error: 'Erro ao adicionar gasto' });
      }
      res.json({ id: result.insertId, descricao, valor, mes, ano });
    });
});

// Iniciar servidor na porta 3000
app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});
