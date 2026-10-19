export interface DamageFormulaVariables {
  atk: number;
  def: number;
  base: number;
  mul: number;
  rand: number;
  speed: number;
  luck: number;
  spiritualSense: number;
  armorPenetration: number;
  block: number;
  senseDiff: number;
  effectiveDef: number;
}

export type DamageCalculator = (variables: DamageFormulaVariables) => number;

export const DEFAULT_COMBAT_DAMAGE_FORMULA = "((atk + armorPenetration * 0.28 + speed * 0.2 + luck * 0.1) * mul + base) * (100 / (100 + max(0, effectiveDef))) * rand";

const LEGACY_COMBAT_DAMAGE_FORMULAS = new Set([
  "((atk + spiritualSense * 0.75 + speed * 0.2 + luck * 0.1) * mul + base) * (100 / (100 + max(0, effectiveDef))) * (1 + max(-0.2, min(0.35, senseDiff / 220))) * rand",
  "max(1, ((atk + spiritualSense * 0.82 + speed * 0.18 + luck * 0.08 + armorPenetration * 0.22) * mul + base) * (100 / (100 + max(0, effectiveDef * 0.92))) * (1 + max(-0.18, min(0.32, senseDiff / 240))) * rand)",
]);

const ALLOWED_FORMULA_CHARS_REGEX = /^[0-9a-zA-Z_+\-*/(),.\s]+$/;
const IDENTIFIER_REGEX = /[a-zA-Z_][a-zA-Z0-9_]*/g;
const ALLOWED_IDENTIFIERS = new Set([
  "atk",
  "def",
  "base",
  "mul",
  "rand",
  "speed",
  "luck",
  "spiritualSense",
  "armorPenetration",
  "block",
  "senseDiff",
  "effectiveDef",
  "min",
  "max",
  "floor",
  "ceil",
  "round",
]);
const FORMULA_VARIABLE_NAMES = new Set([
  "atk",
  "def",
  "base",
  "mul",
  "rand",
  "speed",
  "luck",
  "spiritualSense",
  "armorPenetration",
  "block",
  "senseDiff",
  "effectiveDef",
] satisfies Array<keyof DamageFormulaVariables>);
const FORMULA_FUNCTION_NAMES = new Set(["min", "max", "floor", "ceil", "round"]);

type FormulaToken =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma"; value: "," };

type FormulaNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: keyof DamageFormulaVariables }
  | { type: "unary"; operator: "+" | "-"; operand: FormulaNode }
  | { type: "binary"; operator: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode }
  | { type: "call"; name: "min" | "max" | "floor" | "ceil" | "round"; args: FormulaNode[] };

export interface BattleDamageCalculatorOptions {
  onCompileError?: (formula: string, error: unknown) => void;
  onRuntimeError?: (formula: string, error: unknown) => void;
}

function computeDefaultDamageRaw(variables: DamageFormulaVariables) {
  const effectiveDefense = Math.max(0, Number.isFinite(variables.effectiveDef) ? variables.effectiveDef : variables.def);
  const attackPower = (
    variables.atk
    + variables.armorPenetration * 0.28
    + variables.speed * 0.2
    + variables.luck * 0.1
  );
  const baseDamage = attackPower * variables.mul + variables.base;
  const reduction = 100 / (100 + effectiveDefense);
  return baseDamage * reduction * variables.rand;
}

function normalizeDamageValue(value: number) {
  return Math.max(1, Math.floor(value));
}

export function calculateDefaultCombatDamage(variables: DamageFormulaVariables) {
  return normalizeDamageValue(computeDefaultDamageRaw(variables));
}

export function normalizeCombatDamageFormula(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) {
    return DEFAULT_COMBAT_DAMAGE_FORMULA;
  }
  if (LEGACY_COMBAT_DAMAGE_FORMULAS.has(text)) {
    return DEFAULT_COMBAT_DAMAGE_FORMULA;
  }
  return text;
}

function validateAllowedCharacters(expression: string) {
  if (!ALLOWED_FORMULA_CHARS_REGEX.test(expression)) {
    throw new Error("Formula contains unsupported characters");
  }
}

function validateDots(expression: string) {
  for (let i = 0; i < expression.length; i += 1) {
    if (expression[i] !== ".") {
      continue;
    }
    const prev = expression[i - 1] || "";
    const next = expression[i + 1] || "";
    if (!/[0-9]/.test(prev) || !/[0-9]/.test(next)) {
      throw new Error("Dots are only allowed inside decimal numbers");
    }
  }
}

function validateIdentifiers(expression: string) {
  const identifiers = expression.match(IDENTIFIER_REGEX) || [];
  for (const identifier of identifiers) {
    if (!ALLOWED_IDENTIFIERS.has(identifier)) {
      throw new Error(`Unsupported identifier: ${identifier}`);
    }
  }
}

function assertFormulaSafe(expression: string) {
  if (!expression.trim()) {
    throw new Error("Damage formula cannot be empty");
  }
  validateAllowedCharacters(expression);
  validateDots(expression);
  validateIdentifiers(expression);
}

function tokenizeFormula(expression: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const current = expression[index];
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(current)) {
      let endIndex = index + 1;
      while (endIndex < expression.length && /[0-9.]/.test(expression[endIndex])) {
        endIndex += 1;
      }
      const rawNumber = expression.slice(index, endIndex);
      const value = Number(rawNumber);
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number: ${rawNumber}`);
      }
      tokens.push({ type: "number", value });
      index = endIndex;
      continue;
    }

    if (/[a-zA-Z_]/.test(current)) {
      let endIndex = index + 1;
      while (endIndex < expression.length && /[a-zA-Z0-9_]/.test(expression[endIndex])) {
        endIndex += 1;
      }
      tokens.push({
        type: "identifier",
        value: expression.slice(index, endIndex),
      });
      index = endIndex;
      continue;
    }

    if (current === "+" || current === "-" || current === "*" || current === "/") {
      tokens.push({ type: "operator", value: current });
      index += 1;
      continue;
    }

    if (current === "(" || current === ")") {
      tokens.push({ type: "paren", value: current });
      index += 1;
      continue;
    }

    if (current === ",") {
      tokens.push({ type: "comma", value: current });
      index += 1;
      continue;
    }

    throw new Error(`Cannot parse formula character: ${current}`);
  }

  return tokens;
}

function parseFormula(expression: string): FormulaNode {
  const tokens = tokenizeFormula(expression);
  let index = 0;

  const peek = () => tokens[index];
  const consume = () => {
    const token = tokens[index];
    index += 1;
    return token;
  };

  const expectParen = (value: "(" | ")") => {
    const token = consume();
    if (!token || token.type !== "paren" || token.value !== value) {
      throw new Error(`Formula is missing ${value}`);
    }
  };

  const parseExpressionNode = (): FormulaNode => parseAdditiveNode();

  const parseAdditiveNode = (): FormulaNode => {
    let node = parseMultiplicativeNode();
    while (true) {
      const token = peek();
      if (!token || token.type !== "operator" || (token.value !== "+" && token.value !== "-")) {
        break;
      }
      consume();
      node = {
        type: "binary",
        operator: token.value,
        left: node,
        right: parseMultiplicativeNode(),
      };
    }
    return node;
  };

  const parseMultiplicativeNode = (): FormulaNode => {
    let node = parseUnaryNode();
    while (true) {
      const token = peek();
      if (!token || token.type !== "operator" || (token.value !== "*" && token.value !== "/")) {
        break;
      }
      consume();
      node = {
        type: "binary",
        operator: token.value,
        left: node,
        right: parseUnaryNode(),
      };
    }
    return node;
  };

  const parseUnaryNode = (): FormulaNode => {
    const token = peek();
    if (token?.type === "operator" && (token.value === "+" || token.value === "-")) {
      consume();
      return {
        type: "unary",
        operator: token.value,
        operand: parseUnaryNode(),
      };
    }
    return parsePrimaryNode();
  };

  const parsePrimaryNode = (): FormulaNode => {
    const token = consume();
    if (!token) {
      throw new Error("Formula ended unexpectedly");
    }

    if (token.type === "number") {
      return { type: "number", value: token.value };
    }

    if (token.type === "identifier") {
      const nextToken = peek();
      if (nextToken?.type === "paren" && nextToken.value === "(") {
        if (!FORMULA_FUNCTION_NAMES.has(token.value)) {
          throw new Error(`Unsupported function: ${token.value}`);
        }
        consume();
        const args: FormulaNode[] = [];
        if (!(peek()?.type === "paren" && peek()?.value === ")")) {
          while (true) {
            args.push(parseExpressionNode());
            const separator = peek();
            if (separator?.type === "comma") {
              consume();
              continue;
            }
            break;
          }
        }
        expectParen(")");
        return {
          type: "call",
          name: token.value as "min" | "max" | "floor" | "ceil" | "round",
          args,
        };
      }

      if (!FORMULA_VARIABLE_NAMES.has(token.value as keyof DamageFormulaVariables)) {
        throw new Error(`Unsupported variable: ${token.value}`);
      }
      return {
        type: "variable",
        name: token.value as keyof DamageFormulaVariables,
      };
    }

    if (token.type === "paren" && token.value === "(") {
      const node = parseExpressionNode();
      expectParen(")");
      return node;
    }

    throw new Error("Invalid formula structure");
  };

  const root = parseExpressionNode();
  if (index < tokens.length) {
    throw new Error("Formula has unparsed trailing content");
  }
  return root;
}

function evaluateFormulaNode(node: FormulaNode, variables: DamageFormulaVariables): number {
  switch (node.type) {
    case "number":
      return node.value;
    case "variable": {
      const value = Number(variables[node.name]);
      if (!Number.isFinite(value)) {
        throw new Error(`Formula variable is not finite: ${node.name}`);
      }
      return value;
    }
    case "unary": {
      const value = evaluateFormulaNode(node.operand, variables);
      return node.operator === "-" ? -value : value;
    }
    case "binary": {
      const left = evaluateFormulaNode(node.left, variables);
      const right = evaluateFormulaNode(node.right, variables);
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
      }
    }
    case "call": {
      const args = node.args.map((item) => evaluateFormulaNode(item, variables));
      if (args.some((value) => !Number.isFinite(value))) {
        throw new Error(`Formula function received invalid args: ${node.name}`);
      }
      switch (node.name) {
        case "min":
          if (args.length < 1) {
            throw new Error("min requires at least one argument");
          }
          return Math.min(...args);
        case "max":
          if (args.length < 1) {
            throw new Error("max requires at least one argument");
          }
          return Math.max(...args);
        case "floor":
          if (args.length !== 1) {
            throw new Error("floor requires exactly one argument");
          }
          return Math.floor(args[0]);
        case "ceil":
          if (args.length !== 1) {
            throw new Error("ceil requires exactly one argument");
          }
          return Math.ceil(args[0]);
        case "round":
          if (args.length !== 1) {
            throw new Error("round requires exactly one argument");
          }
          return Math.round(args[0]);
      }
    }
  }
}

export function compileCombatDamageFormula(expression: string): DamageCalculator {
  assertFormulaSafe(expression);
  const parsedFormula = parseFormula(expression);

  return (variables: DamageFormulaVariables) => {
    const raw = evaluateFormulaNode(parsedFormula, variables);
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      throw new Error("Formula result is not finite");
    }
    return normalizeDamageValue(numeric);
  };
}

export function buildCombatDamageCalculator(
  formulaText: string,
  options: BattleDamageCalculatorOptions = {},
): DamageCalculator {
  const formula = normalizeCombatDamageFormula(formulaText);
  if (formula === DEFAULT_COMBAT_DAMAGE_FORMULA) {
    return calculateDefaultCombatDamage;
  }

  let compiled: DamageCalculator;
  try {
    compiled = compileCombatDamageFormula(formula);
  } catch (error) {
    options.onCompileError?.(formula, error);
    return calculateDefaultCombatDamage;
  }

  return (variables: DamageFormulaVariables) => {
    try {
      return compiled(variables);
    } catch (error) {
      options.onRuntimeError?.(formula, error);
      return calculateDefaultCombatDamage(variables);
    }
  };
}
