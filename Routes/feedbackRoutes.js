const express = require('express');
const {
  submitFeedback,
  getFeedback,
  getFeedbackById,
  updateFeedback,
  getFeedbackStats,
  deleteFeedback
} = require('../Controllers/feedbackController');

const router = express.Router();

// Public route - anyone can submit feedback
router.post('/', submitFeedback);

// Admin routes
router.get('/', getFeedback);
router.get('/stats', getFeedbackStats);
router.get('/:id', getFeedbackById);
router.put('/:id', updateFeedback);
router.delete('/:id', deleteFeedback);

module.exports = router;