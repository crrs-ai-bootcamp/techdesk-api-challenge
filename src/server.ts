import express, { Request, Response } from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';

// ============================================================================
// ARQUIVO MONOLÍTICO: Conexão DB + Schema + Seed + Regras + Todas as Rotas
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

// Cria automaticamente o arquivo SQLite local (techdesk.db) se não existir
const dbPath = path.resolve(process.cwd(), 'techdesk.db');
const db = new Database(dbPath);

// Criação da tabela 'tickets' diretamente no escopo global de inicialização
db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN'
  );
`);

// Seed inicial acoplado na inicialização caso a tabela esteja vazia
const countRow: any = db.prepare('SELECT COUNT(*) as total FROM tickets').get();
if (countRow && countRow.total === 0) {
  db.exec(`
    INSERT INTO tickets (title, description, status) VALUES
      ('Erro no servidor VPN corporativo', 'Usuários da filial SP não conseguem autenticar na VPN desde as 08h.', 'OPEN'),
      ('Impressora do 3º andar travada', 'Fila de impressão congestionada com erro de spooler no Windows Server.', 'OPEN'),
      ('Reset de senha do ERP Financeiro', 'Solicitação concluída após validação com gestor da área.', 'CLOSED'),
      ('Lentidão extrema no banco de dados de relatórios', 'Queries de fechamento mensal estão demorando mais de 15 minutos.', 'OPEN');
  `);
}

// ============================================================================
// GET /tickets - Listagem e busca de tickets (COM VULNERABILIDADE SQL INJECTION)
// ============================================================================
app.get('/tickets', (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;

    let sql = 'SELECT * FROM tickets WHERE 1=1';

    // REGRA 2 (MÁ PRÁTICA): Concatenação direta na string SQL (SQL Injection!)
    if (search) {
      sql += " AND title LIKE '%" + search + "%'";
    }

    if (status) {
      sql += " AND status = '" + status + "'";
    }

    sql += ' ORDER BY id DESC';

    const rows = db.prepare(sql).all();
    return res.status(200).json(rows);
  } catch (err) {
    // REGRA 3 (MÁ PRÁTICA): Catch genérico sem log descritivo
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================================
// GET /tickets/:id - Busca detalhes de um ticket específico
// ============================================================================
app.get('/tickets/:id', (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    // Concatenação direta também no ID
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ' + id).get();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    return res.status(200).json(ticket);
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================================
// POST /tickets - Criação de ticket (COM REGRAS E IFS ANINHADOS NA ROTA)
// ============================================================================
app.post('/tickets', (req: Request, res: Response) => {
  try {
    const body = req.body;

    // REGRA 4 (MÁ PRÁTICA): Validações extensas com ifs profundamente aninhados na rota
    if (body) {
      if (body.title !== undefined && body.title !== null) {
        if (typeof body.title === 'string') {
          if (body.title.trim().length >= 5) {
            if (body.title.trim().length <= 120) {
              if (body.description !== undefined && body.description !== null) {
                if (typeof body.description === 'string') {
                  if (body.description.trim().length >= 10) {
                    if (
                      !body.title.toLowerCase().includes('teste123') &&
                      !body.description.toLowerCase().includes('spam')
                    ) {
                      let finalStatus = 'OPEN';
                      if (body.status !== undefined) {
                        if (body.status === 'OPEN' || body.status === 'CLOSED') {
                          finalStatus = body.status;
                        } else {
                          return res.status(400).json({
                            error: 'Status inválido. Valores permitidos: OPEN ou CLOSED.',
                          });
                        }
                      }

                      // Regra de negócio acoplada: bloqueia títulos duplicados abertos
                      const existingOpen: any = db
                        .prepare(
                          "SELECT id FROM tickets WHERE LOWER(title) = LOWER('" +
                            body.title.trim() +
                            "') AND status = 'OPEN'"
                        )
                        .get();

                      if (!existingOpen) {
                        const result = db
                          .prepare(
                            'INSERT INTO tickets (title, description, status) VALUES (?, ?, ?)'
                          )
                          .run(body.title.trim(), body.description.trim(), finalStatus);

                        const created = db
                          .prepare('SELECT * FROM tickets WHERE id = ?')
                          .get(result.lastInsertRowid);

                        return res.status(201).json(created);
                      } else {
                        return res.status(409).json({
                          error: 'Já existe um chamado OPEN com exatamente este título.',
                        });
                      }
                    } else {
                      return res.status(400).json({
                        error: 'Conteúdo bloqueado pelas regras anti-spam do HelpDesk.',
                      });
                    }
                  } else {
                    return res.status(400).json({
                      error: 'A descrição do ticket deve ter pelo menos 10 caracteres.',
                    });
                  }
                } else {
                  return res.status(400).json({
                    error: 'O campo description deve ser uma string.',
                  });
                }
              } else {
                return res.status(400).json({
                  error: 'O campo description é obrigatório.',
                });
              }
            } else {
              return res.status(400).json({
                error: 'O título do ticket não pode ultrapassar 120 caracteres.',
              });
            }
          } else {
            return res.status(400).json({
              error: 'O título do ticket deve ter pelo menos 5 caracteres.',
            });
          }
        } else {
          return res.status(400).json({
            error: 'O campo title deve ser uma string.',
          });
        }
      } else {
        return res.status(400).json({
          error: 'O campo title é obrigatório.',
        });
      }
    } else {
      return res.status(400).json({
        error: 'Payload da requisição ausente.',
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================================
// PUT /tickets/:id - Atualização de chamado
// ============================================================================
app.put('/tickets/:id', (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { title, description, status } = req.body;

    const current: any = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    if (status && status !== 'OPEN' && status !== 'CLOSED') {
      return res.status(400).json({ error: 'Status deve ser OPEN ou CLOSED' });
    }

    const nextTitle = title !== undefined ? title : current.title;
    const nextDesc = description !== undefined ? description : current.description;
    const nextStatus = status !== undefined ? status : current.status;

    db.prepare(
      'UPDATE tickets SET title = ?, description = ?, status = ? WHERE id = ?'
    ).run(nextTitle, nextDesc, nextStatus, id);

    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================================
// DELETE /tickets/:id - Exclusão de chamado
// ============================================================================
app.delete('/tickets/:id', (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const current = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);

    if (!current) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
    return res.status(200).json({ message: 'Ticket removido com sucesso' });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔥 TechDesk Legacy API rodando em http://localhost:${PORT}`);
  console.log(`📦 Banco SQLite inicializado em: ${dbPath}`);
});
