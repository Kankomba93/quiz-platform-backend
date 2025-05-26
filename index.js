// Updated Backend: Adds vote tracking and leaderboard tallying

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomParticipants = {};
const loadedQuizzes = {};
const quizAdmins = {};
const votes = {}; // quizId -> [voteCount per question]
const scores = {}; // quizId -> { username: score }

function loadQuiz(quizId) {
  const filePath = path.join(__dirname, 'quizzes', `${quizId}.json`);
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath);
    loadedQuizzes[quizId] = JSON.parse(data);
  }
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ username, quizId, isAdmin }) => {
    socket.join(quizId);
    socket.quizId = quizId;
    socket.username = username;

    if (!roomParticipants[quizId]) roomParticipants[quizId] = new Set();
    roomParticipants[quizId].add(socket.id);

    if (isAdmin) {
      quizAdmins[quizId] = socket.id;
      socket.emit('adminVerified');
    }

    io.to(quizId).emit('participantCount', roomParticipants[quizId].size);

    if (!loadedQuizzes[quizId]) {
      loadQuiz(quizId);
    }
    if (!scores[quizId]) scores[quizId] = {};
  });

  socket.on('sendMessage', ({ message, quizId, username }) => {
    io.to(quizId).emit('chatMessage', { message, username });
  });

  socket.on('startQuiz', ({ quizId }) => {
    if (quizAdmins[quizId] !== socket.id || !loadedQuizzes[quizId]) return;

    const questions = loadedQuizzes[quizId];
    let index = 0;
    votes[quizId] = questions.map(q => Array(q.options.length).fill(0));

    io.to(quizId).emit('quizStarting');

    const sendQuestion = () => {
      if (index >= questions.length) {
        const leaderboard = Object.entries(scores[quizId] || {})
          .map(([username, score]) => ({ username, score }))
          .sort((a, b) => b.score - a.score);

        io.to(quizId).emit('quizEnded', leaderboard);
        return;
      }

      const q = questions[index];
      io.to(quizId).emit('newQuestion', { question: q.question, options: q.options, index });

      setTimeout(() => {
        io.to(quizId).emit('voteStats', votes[quizId][index]);
        index++;
        setTimeout(sendQuestion, 1000);
      }, 10000);
    };

    setTimeout(sendQuestion, 3000);
  });

  socket.on('submitAnswer', ({ quizId, questionIndex, answerIndex, username }) => {
    if (!votes[quizId] || !votes[quizId][questionIndex]) return;

    votes[quizId][questionIndex][answerIndex]++;

    const correct = loadedQuizzes[quizId][questionIndex].correctIndex;
    if (answerIndex === correct) {
      if (!scores[quizId][username]) scores[quizId][username] = 0;
      scores[quizId][username] += 10;
    }
  });

  socket.on('disconnect', () => {
    const quizId = socket.quizId;
    if (quizId && roomParticipants[quizId]) {
      roomParticipants[quizId].delete(socket.id);
      io.to(quizId).emit('participantCount', roomParticipants[quizId].size);

      if (quizAdmins[quizId] === socket.id) delete quizAdmins[quizId];
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});