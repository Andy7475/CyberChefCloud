/**
 * Trim tests.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */
import TestRegister from "../../lib/TestRegister.mjs";

TestRegister.addTests([
    {
        name: "Trim: whitespace by default",
        input: " \t hello world \n",
        expectedOutput: "hello world",
        recipeConfig: [{ op: "Trim", args: ["", "Both ends", "All", false] }],
    },
    {
        name: "Trim: quotes, all",
        input: "\"\"quoted\"\"",
        expectedOutput: "quoted",
        recipeConfig: [{ op: "Trim", args: ["\"", "Both ends", "All", false] }],
    },
    {
        name: "Trim: quotes, only one from each end",
        input: "\"\"quoted\"\"",
        expectedOutput: "\"quoted\"",
        recipeConfig: [{ op: "Trim", args: ["\"", "Both ends", "Only one", false] }],
    },
    {
        name: "Trim: character set, start only",
        input: "[('x')]",
        expectedOutput: "x')]",
        recipeConfig: [{ op: "Trim", args: ["[('", "Start", "All", false] }],
    },
    {
        name: "Trim: end only",
        input: "value;;;",
        expectedOutput: "value",
        recipeConfig: [{ op: "Trim", args: [";", "End", "All", false] }],
    },
    {
        name: "Trim: escape sequences in the character set",
        input: "\t\tx\t",
        expectedOutput: "x",
        recipeConfig: [{ op: "Trim", args: ["\\t", "Both ends", "All", false] }],
    },
    {
        name: "Trim: each line separately keeps CRLF line breaks",
        input: "\"a\"\r\n\"b\"\n\"c\"",
        expectedOutput: "a\r\nb\nc",
        recipeConfig: [{ op: "Trim", args: ["\"", "Both ends", "Only one", true] }],
    },
    {
        name: "Trim: whole input only trims the outer ends",
        input: "\"a\"\n\"b\"",
        expectedOutput: "a\"\n\"b",
        recipeConfig: [{ op: "Trim", args: ["\"", "Both ends", "Only one", false] }],
    },
    {
        name: "Trim: characters outside the BMP",
        input: "😀😀hi😀",
        expectedOutput: "hi",
        recipeConfig: [{ op: "Trim", args: ["😀", "Both ends", "All", false] }],
    },
    {
        name: "Trim: input made only of trimmed characters",
        input: "\"",
        expectedOutput: "",
        recipeConfig: [{ op: "Trim", args: ["\"", "Both ends", "Only one", false] }],
    },
]);
