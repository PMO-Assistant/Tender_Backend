const { getConnectedPool } = require('../../config/database');

const formAnswerController = {
    // Create individual answer
    createAnswer: async (req, res) => {
        const { FieldID, Question, Answer, Source, MatchData, Score } = req.body;

        try {
            const pool = await getConnectedPool();
            await pool.request()
                .input('FieldID', FieldID)
                .input('Question', Question)
                .input('Answer', Answer)
                .input('Source', Source)
                .input('MatchData', JSON.stringify(MatchData || {}))
                .input('Score', Score)
                .input('SubmitedAt', new Date())
                .query(`
                    INSERT INTO tenderFormAnswer (
                        FieldID, Question, Answer, Source, MatchData, Score, SubmitedAt
                    ) VALUES (
                        @FieldID, @Question, @Answer, @Source, @MatchData, @Score, @SubmitedAt
                    )
                `);

            res.status(201).json({ message: 'Answer submitted successfully' });
        } catch (err) {
            console.error('Error inserting answer:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get all answers by FieldID
    getAnswersByField: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('FieldID', req.params.fieldId)
                .query('SELECT * FROM tenderFormAnswer WHERE FieldID = @FieldID');

            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Update single answer
    updateAnswer: async (req, res) => {
        const { Answer, Score, Source, MatchData } = req.body;

        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('AnswerID', req.params.id)
                .input('Answer', Answer)
                .input('Score', Score)
                .input('Source', Source)
                .input('MatchData', JSON.stringify(MatchData || {}))
                .input('SubmitedAt', new Date())
                .query(`
                    UPDATE tenderFormAnswer
                    SET Answer = @Answer,
                        Score = @Score,
                        Source = @Source,
                        MatchData = @MatchData,
                        SubmitedAt = @SubmitedAt
                    WHERE AnswerID = @AnswerID
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Answer not found' });
            }

            res.json({ message: 'Answer updated' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = formAnswerController;
