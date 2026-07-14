-- AlterTable
ALTER TABLE `agent_scores` MODIFY `reasoning` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `messages` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `resumes` MODIFY `rawText` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `scenarios` MODIFY `interviewerPrompt` TEXT NOT NULL,
    MODIFY `difficultyPrompt` TEXT NOT NULL;
