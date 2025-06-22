const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// Configuration - Use environment variables in production
const CONFIG = {
  VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'my_verify_token',
  APP_SECRET: process.env.APP_SECRET || 'c99c3dd7a297b211ed14bde0ea07aaed',
  APP_ID: process.env.APP_ID || '746900911117879',
  PAGE_ACCESS_TOKEN: process.env.PAGE_ACCESS_TOKEN || 'EAAKnTWt9VjcBO7foxY2PP3JSqfrgtLimpOk2gpPnHFFwvDFp9ZBDAib9CfEvWHRqAvBt6LUD5Bg4lFHI1pZBQx8pXqviKdevCNVnh7zfUVCDZCrGiiGGiaMsBOGH1ZB3BUrEaYAorPVq34fhwcZBKHAbUExHwfzxSAnd8hvmZC0dN8nVSCSZC60vP94lZBB1w8ZBiRYrBIYghZCgZDZD', // Set this after page connection
};

// Middleware
app.use(cors({
  origin: ['http://localhost:3001', 'https://1ef4-2405-201-a413-8a52-8c11-dfad-554d-49bf.ngrok-free.app/webhook'], // Add your domains
  credentials: true
}));

// Raw body parser for webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket server
const wss = new WebSocket.Server({ server });
const clients = new Map(); // Store clients with user identification

wss.on('connection', (ws, req) => {
  console.log('🔌 New WebSocket client connected');
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'auth' && message.userId) {
        clients.set(ws, { userId: message.userId, lastSeen: Date.now() });
        console.log(`👤 Client authenticated for user: ${message.userId}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Enhanced broadcast function with user targeting
function broadcastToUser(userId, data) {
  let sent = false;
  clients.forEach((clientInfo, ws) => {
    if (clientInfo.userId === userId && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
        sent = true;
      } catch (error) {
        console.error('Error sending message to client:', error);
        clients.delete(ws);
      }
    }
  });
  return sent;
}

function broadcastToAll(data) {
  clients.forEach((clientInfo, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        console.error('Error broadcasting to client:', error);
        clients.delete(ws);
      }
    }
  });
}

// Database simulation (use a real database in production)
let users = new Map();
let pageConnections = new Map(); // userId -> pageData
let conversations = new Map(); // pageId+senderId -> conversation

// ====== ROOT TEST ======
app.get('/', (req, res) => {
  res.json({
    message: 'Facebook Webhook Server is running!',
    status: 'online',
    timestamp: new Date().toISOString(),
    connectedClients: clients.size,
    activeConnections: pageConnections.size
  });
});

// Serve the main HTML file
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====== WEBHOOK SIGNATURE VERIFICATION ======
function verifyWebhookSignature(req, res, next) {
  if (req.method === 'GET') return next(); // Skip for verification
  
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    console.log('❌ Missing signature');
    return res.sendStatus(401);
  }

  const expectedSignature = crypto
    .createHmac('sha256', CONFIG.APP_SECRET)
    .update(req.body)
    .digest('hex');

  if (signature !== `sha256=${expectedSignature}`) {
    console.log('❌ Invalid signature');
    return res.sendStatus(401);
  }

  // Parse JSON after verification
  req.body = JSON.parse(req.body.toString());
  next();
}

// ====== FACEBOOK WEBHOOK VERIFICATION ======
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔍 Webhook verification attempt:', { mode, token });

  if (mode && token) {
    if (mode === 'subscribe' && token === CONFIG.VERIFY_TOKEN) {
      console.log('✅ Webhook verified successfully');
      return res.status(200).send(challenge);
    } else {
      console.log('❌ Token mismatch:', { expected: CONFIG.VERIFY_TOKEN, received: token });
      return res.sendStatus(403);
    }
  } else {
    console.log('❌ Missing mode or token');
    return res.sendStatus(400);
  }
});

// ====== HANDLE INCOMING MESSAGES ======
app.post('/webhook', verifyWebhookSignature, (req, res) => {
  const body = req.body;
  console.log('📥 Webhook received:', JSON.stringify(body, null, 2));

  if (body.object === 'page') {
    body.entry.forEach(entry => {
      const pageId = entry.id;
      
      if (entry.messaging) {
        entry.messaging.forEach(event => {
          console.log('📨 Processing messaging event:', event);
          
          if (event.message && !event.message.is_echo) {
            handleIncomingMessage(pageId, event);
          } else if (event.postback) {
            handlePostback(pageId, event);
          } else if (event.message && event.message.is_echo) {
            handleEcho(pageId, event);
          } else {
            console.log('🤷 Unknown event type:', Object.keys(event));
          }
        });
      }

      // Handle other entry types (feed, etc.)
      if (entry.changes) {
        console.log('📝 Page changes:', entry.changes);
      }
    });
    
    res.status(200).send('EVENT_RECEIVED');
  } else {
    console.log('❌ Not a page object:', body.object);
    res.sendStatus(404);
  }
});

// ====== MESSAGE HANDLERS ======
function handleIncomingMessage(pageId, event) {
  const senderId = event.sender.id;
  const recipientId = event.recipient.id;
  const timestamp = event.timestamp;
  const message = event.message;

  console.log(`📩 Incoming message from ${senderId} to page ${pageId}`);

  // Store conversation
  const conversationKey = `${pageId}_${senderId}`;
  if (!conversations.has(conversationKey)) {
    conversations.set(conversationKey, {
      pageId,
      senderId,
      messages: [],
      lastActivity: timestamp,
      unreadCount: 0
    });
  }

  const conversation = conversations.get(conversationKey);
  const messageData = {
    id: message.mid,
    senderId,
    recipientId,
    timestamp,
    text: message.text || '',
    attachments: message.attachments || [],
    isIncoming: true
  };

  conversation.messages.push(messageData);
  conversation.lastActivity = timestamp;
  conversation.unreadCount++;

  // Find which user owns this page and notify them
  const pageOwner = findPageOwner(pageId);
  if (pageOwner) {
    const notificationData = {
      type: 'new_message',
      conversationKey,
      message: messageData,
      conversation: {
        senderId,
        lastMessage: message.text || '[Attachment]',
        timestamp,
        unreadCount: conversation.unreadCount
      }
    };

    const sent = broadcastToUser(pageOwner, notificationData);
    console.log(`📡 Notification ${sent ? 'sent' : 'failed'} to user ${pageOwner}`);
  }
}

function handlePostback(pageId, event) {
  const senderId = event.sender.id;
  const postback = event.postback;

  console.log(`🔘 Postback from ${senderId} to page ${pageId}:`, postback);

  const pageOwner = findPageOwner(pageId);
  if (pageOwner) {
    broadcastToUser(pageOwner, {
      type: 'postback',
      senderId,
      pageId,
      payload: postback.payload,
      title: postback.title,
      timestamp: event.timestamp
    });
  }
}

function handleEcho(pageId, event) {
  // Handle echo events (messages sent by the page)
  const senderId = event.sender.id;
  const recipientId = event.recipient.id;
  const message = event.message;

  console.log(`📤 Echo from page ${pageId} to ${recipientId}`);

  // Store in conversation
  const conversationKey = `${pageId}_${recipientId}`;
  if (conversations.has(conversationKey)) {
    const conversation = conversations.get(conversationKey);
    conversation.messages.push({
      id: message.mid,
      senderId,
      recipientId,
      timestamp: event.timestamp,
      text: message.text || '',
      attachments: message.attachments || [],
      isIncoming: false
    });
  }
}

function findPageOwner(pageId) {
  for (const [userId, pageData] of pageConnections) {
    if (pageData.pageId === pageId) {
      return userId;
    }
  }
  return null;
}

// ====== API ENDPOINTS ======

// User registration
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  
  if (users.has(email)) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  const user = {
    id: Date.now().toString(),
    name,
    email,
    password, // Hash this in production!
    createdAt: new Date().toISOString()
  };

  users.set(email, user);
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

// User login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.get(email);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ 
    success: true, 
    user: { id: user.id, name: user.name, email: user.email }
  });
});

// Connect Facebook page
app.post('/api/connect-page', (req, res) => {
  const { userId, pageId, pageName, pageAccessToken } = req.body;

  if (!userId || !pageId || !pageAccessToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  pageConnections.set(userId, {
    pageId,
    pageName,
    pageAccessToken,
    connectedAt: new Date().toISOString()
  });

  console.log(`✅ Page connected: ${pageName} (${pageId}) for user ${userId}`);
  res.json({ success: true });
});

// Get conversations for a user
app.get('/api/conversations/:userId', (req, res) => {
  const { userId } = req.params;
  const pageData = pageConnections.get(userId);

  if (!pageData) {
    return res.json({ conversations: [] });
  }

  const userConversations = [];
  conversations.forEach((conversation, key) => {
    if (conversation.pageId === pageData.pageId) {
      userConversations.push({
        id: conversation.senderId,
        senderId: conversation.senderId,
        lastMessage: conversation.messages[conversation.messages.length - 1]?.text || '',
        timestamp: conversation.lastActivity,
        unreadCount: conversation.unreadCount,
        messages: conversation.messages
      });
    }
  });

  res.json({ conversations: userConversations });
});

// Send message
app.post('/api/send-message', async (req, res) => {
  const { userId, recipientId, text } = req.body;
  const pageData = pageConnections.get(userId);

  if (!pageData || !text || !recipientId) {
    return res.status(400).json({ error: 'Missing required data' });
  }

  try {
    // Send via Facebook Graph API
    const response = await fetch(`https://graph.facebook.com/v18.0/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        access_token: pageData.pageAccessToken
      })
    });

    const result = await response.json();

    if (result.error) {
      console.error('❌ Facebook API error:', result.error);
      return res.status(400).json({ error: result.error.message });
    }

    console.log('✅ Message sent successfully:', result);
    res.json({ success: true, messageId: result.message_id });

  } catch (error) {
    console.error('❌ Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ====== HEALTH ENDPOINTS ======
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    websocketClients: clients.size,
    activePages: pageConnections.size,
    totalConversations: conversations.size
  });
});

app.get('/api/webhook-info', (req, res) => {
  const baseUrl = req.get('host');
  const protocol = req.get('x-forwarded-proto') || 'http';
  
  res.json({
    webhookUrl: `${protocol}://${baseUrl}/webhook`,
    verifyToken: CONFIG.VERIFY_TOKEN,
    status: 'ready'
  });
});

// ====== START SERVER ======
server.listen(PORT, () => {
  console.log('🚀 Enhanced Facebook Webhook Server started');
  console.log(`📡 HTTP Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket Server: ws://localhost:${PORT}`);
  console.log(`🔐 Verify Token: ${CONFIG.VERIFY_TOKEN}`);
  console.log('📝 Endpoints:');
  console.log('   GET  / - Server status');
  console.log('   GET  /dashboard - Main application');
  console.log('   GET  /webhook - Webhook verification');
  console.log('   POST /webhook - Receive Facebook messages');
  console.log('   POST /api/register - User registration');
  console.log('   POST /api/login - User login');
  console.log('   POST /api/connect-page - Connect Facebook page');
  console.log('   GET  /api/conversations/:userId - Get conversations');
  console.log('   POST /api/send-message - Send message');
  console.log('   GET  /health - Health check');
  console.log('   GET  /api/webhook-info - Webhook configuration info');
});

// ====== CLEANUP ON SHUTDOWN ======
process.on('SIGINT', () => {
  console.log('🛑 Shutting down server...');
  clients.forEach((clientInfo, ws) => ws.close());
  server.close(() => {
    console.log('✅ Server shutdown complete');
    process.exit(0);
  });
});

// Periodic cleanup of inactive connections
setInterval(() => {
  const now = Date.now();
  clients.forEach((clientInfo, ws) => {
    if (now - clientInfo.lastSeen > 300000) { // 5 minutes
      console.log('🧹 Cleaning up inactive client');
      ws.close();
      clients.delete(ws);
    }
  });
}, 60000); // Check every minute