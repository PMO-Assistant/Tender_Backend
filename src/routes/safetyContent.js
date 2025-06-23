const express = require('express')
const router = express.Router()
const SafetyContent = require('../models/SafetyContent')
const validateAdcoToken = require('../middleware/validateAdcoToken')

// Get all safety content
router.get('/', validateAdcoToken, async (req, res) => {
  try {
    const content = await SafetyContent.findAll()
    res.json(content)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get safety content by ID
router.get('/:id', validateAdcoToken, async (req, res) => {
  try {
    const content = await SafetyContent.findById(req.params.id)
    if (!content) {
      return res.status(404).json({ error: 'Safety content not found' })
    }
    res.json(content)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Create new safety content
router.post('/', validateAdcoToken, async (req, res) => {
  try {
    const { id, title, subtitle, location, content } = req.body
    
    // Validate required fields
    if (!id || !title || !subtitle || !location || !content) {
      return res.status(400).json({ error: 'All fields are required' })
    }

    const safetyContent = await SafetyContent.create({ id, title, subtitle, location, content })
    res.status(201).json(safetyContent)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Update safety content
router.put('/:id', validateAdcoToken, async (req, res) => {
  try {
    const { title, subtitle, location, content } = req.body
    
    // Validate required fields
    if (!title || !subtitle || !location || !content) {
      return res.status(400).json({ error: 'All fields are required' })
    }

    const safetyContent = await SafetyContent.update(req.params.id, { title, subtitle, location, content })
    res.json(safetyContent)
  } catch (error) {
    if (error.message === 'Safety content not found') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: error.message })
  }
})

// Delete safety content
router.delete('/:id', validateAdcoToken, async (req, res) => {
  try {
    await SafetyContent.delete(req.params.id)
    res.json({ message: 'Safety content deleted successfully' })
  } catch (error) {
    if (error.message === 'Safety content not found') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: error.message })
  }
})

module.exports = router 