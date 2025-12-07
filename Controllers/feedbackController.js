const Feedback = require('../Models/Feedback');

// @desc    Submit new feedback
// @route   POST /api/feedback
// @access  Public
const submitFeedback = async (req, res) => {
  try {
    const { type, message, userEmail } = req.body;

    if (!message || !type) {
      return res.status(400).json({
        success: false,
        message: 'Message and type are required'
      });
    }

    const feedback = await Feedback.create({
      type,
      message,
      userEmail: userEmail || '',
      pageUrl: req.headers.referer || '',
      userAgent: req.headers['user-agent'] || ''
    });

    res.status(201).json({
      success: true,
      data: feedback,
      message: 'Feedback submitted successfully'
    });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while submitting feedback'
    });
  }
};

// @desc    Get all feedback
// @route   GET /api/feedback
// @access  Public (for now, can add admin auth later)
const getFeedback = async (req, res) => {
  try {
    const feedbacks = await Feedback.find().sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: feedbacks,
      count: feedbacks.length
    });
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching feedback'
    });
  }
};

// @desc    Get feedback statistics
// @route   GET /api/feedback/stats
// @access  Public
const getFeedbackStats = async (req, res) => {
  try {
    const total = await Feedback.countDocuments();
    const newCount = await Feedback.countDocuments({ status: 'new' });
    const inProgress = await Feedback.countDocuments({ status: 'in-progress' });
    const resolved = await Feedback.countDocuments({ status: 'resolved' });
    
    // Calculate today's feedback (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = await Feedback.countDocuments({
      createdAt: { $gte: twentyFourHoursAgo }
    });

    res.json({
      success: true,
      data: {
        total,
        today,
        new: newCount,
        inProgress,
        resolved
      }
    });
  } catch (error) {
    console.error('Get feedback stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching stats'
    });
  }
};

// @desc    Get single feedback by ID
// @route   GET /api/feedback/:id
// @access  Public
const getFeedbackById = async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id);
    
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.json({
      success: true,
      data: feedback
    });
  } catch (error) {
    console.error('Get feedback by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching feedback'
    });
  }
};

// @desc    Update feedback
// @route   PUT /api/feedback/:id
// @access  Public
const updateFeedback = async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    
    const feedback = await Feedback.findById(req.params.id);
    
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    // Update fields if provided
    if (status) feedback.status = status;
    if (adminNotes !== undefined) feedback.adminNotes = adminNotes;

    const updatedFeedback = await feedback.save();

    res.json({
      success: true,
      data: updatedFeedback,
      message: 'Feedback updated successfully'
    });
  } catch (error) {
    console.error('Update feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating feedback'
    });
  }
};

// @desc    Delete feedback
// @route   DELETE /api/feedback/:id
// @access  Public
const deleteFeedback = async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id);
    
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    await Feedback.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Feedback deleted successfully'
    });
  } catch (error) {
    console.error('Delete feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting feedback'
    });
  }
};

module.exports = {
  submitFeedback,
  getFeedback,
  getFeedbackById,
  updateFeedback,
  getFeedbackStats,
  deleteFeedback
};