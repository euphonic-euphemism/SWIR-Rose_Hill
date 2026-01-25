/**
 * @typedef {Object} BlockResult
 * @property {number} blockSize
 * @property {string[]} targets - The correct answers (e.g., ["Street", "Bed", "Grass", "Ball", "Door"])
 * @property {string[]} recalled - What the patient said (e.g., ["Door", "Ball", "Street"])
 */

/**
 * Calculates the Recency Benefit Score based on SWIR protocol.
 * 
 * Rules:
 * 1. Filter out short blocks (size < 5).
 * 2. Identify Recency Targets (Last 2 words of the targets array).
 * 3. Check if targets appear anywhere in recalled array.
 * 4. Calculate percentage.
 * 
 * @param {BlockResult[]} results
 * @returns {number} Score from 0 to 100
 */
export const calculateBenefitScore = (results) => {
    let totalRecencyHits = 0;
    let totalRecencyPossible = 0;

    for (const block of results) {
        // Rule 1: Filter out short blocks (size < 5)
        if (block.blockSize < 5) {
            continue;
        }

        // Safety check
        if (!block.targets || block.targets.length === 0) {
            continue;
        }

        // Rule 2: Identify Recency Sentences (Last 2 sentences/targets of the block)
        // We assume the 'targets' array represents the ordered list of target words for that block.
        // We want the last 2 items.
        const startIndex = Math.max(0, block.targets.length - 2);
        const recencyTargets = block.targets.slice(startIndex);

        // Rule 3: Math (1 point per target)
        totalRecencyPossible += recencyTargets.length;

        // Normalize recalled words for case-insensitive matching
        // Note: In the App, we likely passed "correct" targets in the 'recalled' array if we used this interface strictly.
        // But assuming 'recalled' contains ALL words patient said, or just the ones they got right.
        // If the input 'recalled' tracks what they got right, we just check existence.
        const normalizedRecalled = (block.recalled || []).map(w =>
            w.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "")
        );

        recencyTargets.forEach(target => {
            const normalizedTarget = target.toLowerCase().trim().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
            if (normalizedRecalled.includes(normalizedTarget)) {
                totalRecencyHits++;
            }
        });
    }

    // Rule 4: Percentage
    if (totalRecencyPossible === 0) return 0;
    return (totalRecencyHits / totalRecencyPossible) * 100;
};
