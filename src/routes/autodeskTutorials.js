const express = require('express')
const router = express.Router()
const AutodeskTutorial = require('../models/AutodeskTutorial')

// Get all autodesk tutorials
router.get('/', async (req, res) => {
  try {
    const tutorials = await AutodeskTutorial.findAll()
    res.json(tutorials)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get autodesk tutorial by ID
router.get('/:id', async (req, res) => {
  try {
    const tutorial = await AutodeskTutorial.findById(req.params.id)
    if (!tutorial) {
      return res.status(404).json({ error: 'Autodesk tutorial not found' })
    }
    res.json(tutorial)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Create new autodesk tutorial
router.post('/', async (req, res) => {
  try {
    const { id, title, subtitle, location, content } = req.body
    
    // Validate required fields
    if (!id || !title || !subtitle || !location || !content) {
      return res.status(400).json({ error: 'All fields are required' })
    }

    const tutorial = await AutodeskTutorial.create({ id, title, subtitle, location, content })
    res.status(201).json(tutorial)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Update autodesk tutorial
router.put('/:id', async (req, res) => {
  try {
    const { title, subtitle, location, content } = req.body
    
    // Validate required fields
    if (!title || !subtitle || !location || !content) {
      return res.status(400).json({ error: 'All fields are required' })
    }

    const tutorial = await AutodeskTutorial.update(req.params.id, { title, subtitle, location, content })
    res.json(tutorial)
  } catch (error) {
    if (error.message === 'Autodesk tutorial not found') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: error.message })
  }
})

// Delete autodesk tutorial
router.delete('/:id', async (req, res) => {
  try {
    await AutodeskTutorial.delete(req.params.id)
    res.json({ message: 'Autodesk tutorial deleted successfully' })
  } catch (error) {
    if (error.message === 'Autodesk tutorial not found') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: error.message })
  }
})

module.exports = router 