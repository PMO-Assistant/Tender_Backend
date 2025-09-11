const { getConnectedPool } = require('../../config/database');

const formQuestionController = {
    // Bulk create questions (same FieldID)
    createQuestions: async (req, res) => {
        const questions = req.body; // array of { FieldID, Question, Source, MatchData, Score }
        if (!Array.isArray(questions)) {
            return res.status(400).json({ message: 'Expected array of questions' });
        }

        try {
            const pool = await getConnectedPool();
            const request = pool.request();

            for (const q of questions) {
                request
                    .input('FieldID', q.FieldID)
                    .input('Question', q.Question)
                    .input('Source', q.Source || null)
                    .input('MatchData', JSON.stringify(q.MatchData || {}))
                    .input('Score', q.Score || null)
                    .query(`
                        INSERT INTO tenderFormAnswer (FieldID, Question, Source, MatchData, Score)
                        VALUES (@FieldID, @Question, @Source, @MatchData, @Score)
                    `);
            }

            res.status(201).json({ message: 'Questions created successfully' });
        } catch (err) {
            console.error('Error inserting questions:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get all questions by FieldID
    getQuestionsByField: async (req, res) => {
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

    // Update single question
    updateQuestion: async (req, res) => {
        const { Question, Answer, Score, Source, MatchData } = req.body;

        try {
            const pool = await getConnectedPool();
            const result = await pool.request()
                .input('QuestionID', req.params.id)
                .input('Question', Question)
                .input('Answer', Answer)
                .input('Score', Score)
                .input('Source', Source)
                .input('MatchData', JSON.stringify(MatchData || {}))
                .input('SubmitedAt', new Date())
                .query(`
                    UPDATE tenderFormAnswer
                    SET Question = @Question,
                        Answer = @Answer,
                        Score = @Score,
                        Source = @Source,
                        MatchData = @MatchData,
                        SubmitedAt = @SubmitedAt
                    WHERE QuestionID = @QuestionID
                `);

            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Question not found' });
            }

            res.json({ message: 'Question updated' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = formQuestionController;
