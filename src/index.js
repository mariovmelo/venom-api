import express from 'express';
import { create } from 'venom-bot';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const sessions = new Map();

class VenomManager {
  static sessionsFilePath = path.resolve('./sessions.json');
  static sessions = new Map();
  static sessionNameToId = new Map();

  static initialize() {
    // Carrega as sessões salvas do arquivo, se existir
    if (fs.existsSync(this.sessionsFilePath)) {
      const savedSessions = JSON.parse(fs.readFileSync(this.sessionsFilePath, 'utf-8'));
      for (const session of savedSessions) {
        console.log(session.id +" - "+session.name)
        this.sessions.set(session.id, session);
        this.sessionNameToId.set(session.name, session.id);
      }
    }
  }

  static async createSession(sessionName) {
    const sessionId = uuidv4();
    const sessionPath = path.resolve(`./sessions`);

    if (!fs.existsSync('./sessions')) {
      fs.mkdirSync('./sessions');
    }

    return new Promise((resolve, reject) => {
      create(sessionName, (base64Qr) => {
        const newSession = { id: sessionId, name: sessionName, client: null };
        this.sessions.set(sessionId, newSession);
        this.saveSessionsToFile();
        this.sessionNameToId.set(sessionName, sessionId);
        resolve({ sessionId, qrCode: base64Qr });
      }, (statusSession) => {
        console.log(statusSession);
      }, {
        session: sessionName,
        folderNameToken: sessionPath,
        headless:true,
        browserArgs:['--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ],
        
      })
      .then((client) => {
        this.sessions.get(sessionId).client = client;
        //return client;
      })
      .catch(reject);
    });
  }

  static async removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.client){
        await session.client.close();
      }
      this.sessions.delete(sessionId);
      this.sessionNameToId.delete(session.name);
      this.saveSessionsToFile();
      return true;
    }
    return false;
  }

  static getSessionClientByName(sessionName) {
    const sessionId = this.getSessionByName(sessionName);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      return session.client;
    }
    return null;
  }

  static getSessionClientBySessionId(sessionId) {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if(session){
        if(!session.client){
          this.createSession(session.name).then( client =>{
            session.client=client;
          }
          );
        }
        return session.client;
      }
        
    }
    return null;
  }

  static getSessionByName(sessionName) {
    return this.sessionNameToId.get(sessionName);
  }

  static listSessions() {
    VenomManager.initialize()
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      name: session.name
    }));
  }

  static saveSessionsToFile() {
    fs.writeFileSync(this.sessionsFilePath, JSON.stringify(Array.from(this.sessions.values())));
  }
}

app.get('/', (req, res) => {
  const sessions = VenomManager.listSessions();
  res.render('index', { sessions });
});

app.post('/create-session', async (req, res) => {
  const { sessionName } = req.body;
  try {
    const { sessionId, qrCode } = await VenomManager.createSession(sessionName);
    //const qrCodeSaida = qrCode.replace('data:image/png;base64,', '');
    console.log(qrCode)
    res.render('qrcode', { sessionName,sessionId, qrCode });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post('/remove-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  await VenomManager.removeSession(sessionId);
  res.redirect('/');
});

// Rotas para APIs do Venom
app.post('/execute/:sessionId/:method', async (req, res) => {
  const { sessionId, method } = req.params;
  const { params } = req.body;

  try {
    const client = VenomManager.getSessionClientBySessionId(sessionId);
    if (!client) {
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }
    const result = await client[method](...params);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  VenomManager.initialize()
  console.log(`Server running on port ${PORT}`);
});