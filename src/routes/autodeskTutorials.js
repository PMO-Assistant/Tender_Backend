const express = require('express')
const router = express.Router()
const AutodeskTutorial = require('../models/AutodeskTutorial')
const validateAdcoToken = require('../middleware/validateAdcoToken')

// Get all tutorials
router.get('/', validateAdcoToken, async (req, res) => {
  try {
    const tutorials = await AutodeskTutorial.findAll()
    res.json(tutorials)
  } catch (error) {
    console.error('Error fetching tutorials:', error)
    res.status(500).json({ error: 'Failed to fetch tutorials' })
  }
})

// Get a single tutorial by ID
router.get('/:id', validateAdcoToken, async (req, res) => {
  try {
    const tutorial = await AutodeskTutorial.findById(req.params.id)
    if (!tutorial) {
      return res.status(404).json({ error: 'Tutorial not found' })
    }
    res.json(tutorial)
  } catch (error) {
    console.error('Error fetching tutorial:', error)
    res.status(500).json({ error: 'Failed to fetch tutorial' })
  }
})

// Create a new tutorial
router.post('/', validateAdcoToken, async (req, res) => {
  try {
    const tutorial = await AutodeskTutorial.create(req.body)
    res.status(201).json(tutorial)
  } catch (error) {
    console.error('Error creating tutorial:', error)
    res.status(500).json({ error: 'Failed to create tutorial' })
  }
})

// Update a tutorial
router.put('/:id', validateAdcoToken, async (req, res) => {
  try {
    const tutorial = await AutodeskTutorial.update(req.params.id, req.body)
    res.json(tutorial)
  } catch (error) {
    console.error('Error updating tutorial:', error)
    if (error.message === 'Tutorial not found') {
      return res.status(404).json({ error: 'Tutorial not found' })
    }
    res.status(500).json({ error: 'Failed to update tutorial' })
  }
})

// Delete a tutorial
router.delete('/:id', validateAdcoToken, async (req, res) => {
  try {
    await AutodeskTutorial.delete(req.params.id)
    res.status(204).send()
  } catch (error) {
    console.error('Error deleting tutorial:', error)
    if (error.message === 'Tutorial not found') {
      return res.status(404).json({ error: 'Tutorial not found' })
    }
    res.status(500).json({ error: 'Failed to delete tutorial' })
  }
})

module.exports = router 