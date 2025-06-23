const express = require('express')
const router = express.Router()
const ERPTutorial = require('../models/ERPTutorial')
const validateAdcoToken = require('../middleware/validateAdcoToken')

// Get all ERP tutorials
router.get('/', validateAdcoToken, async (req, res) => {
  try {
    const tutorials = await ERPTutorial.findAll()
    res.json(tutorials)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get ERP tutorial by ID
router.get('/:id', validateAdcoToken, async (req, res) => {
  try {
    const tutorial = await ERPTutorial.findById(req.params.id)
    if (!tutorial) {
      return res.status(404).json({ error: 'ERP tutorial not found' })
    }
    res.json(tutorial)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Create new ERP tutorial
router.post('/', validateAdcoToken, async (req, res) => {
  try {
    const { id, title, subtitle, location, content } = req.body
    
    // Validate required fields
    if (!id || !title || !subtitle || !location || !content) {
      return res.status(400).json({ error: 'All fields are required' })
    }

    const tutorial = await ERPTutorial.create({ id, title, subtitle, location, content })
    res.status(201).json(tutorial)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Update ERP tutorial
router.put('/:id', validateAdcoToken, async (req, res) => {
  try {
    const { title, subtitle, location, content } = req.body
    
    // Validate required fields
    if (!title || !subtitle || !location || !content) {
      return res.status(400).json({ error: 'All fields are required' })
    }

    const tutorial = await ERPTutorial.update(req.params.id, { title, subtitle, location, content })
    res.json(tutorial)
  } catch (error) {
    if (error.message === 'ERP tutorial not found') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: error.message })
  }
})

// Delete ERP tutorial
router.delete('/:id', validateAdcoToken, async (req, res) => {
  try {
    await ERPTutorial.delete(req.params.id)
    res.json({ message: 'ERP tutorial deleted successfully' })
  } catch (error) {
    if (error.message === 'ERP tutorial not found') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: error.message })
  }
})

module.exports = router 