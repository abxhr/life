// Public-domain / ancient sources only. Categories: discipline, calm, courage, curiosity, perspective.
export const QUOTES = [
  ['discipline', 'We are what we repeatedly do.', 'after Will Durant on Aristotle'], ['discipline', 'It is not that we have a short time to live, but that we waste much of it.', 'Seneca'],
  ['discipline', 'Well begun is half done.', 'Aristotle'], ['discipline', 'No man is free who is not master of himself.', 'Epictetus'], ['discipline', 'The journey of a thousand miles begins with a single step.', 'Laozi'],
  ['discipline', 'What you do every day matters more than what you do once in a while.', 'proverb'], ['discipline', 'Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['calm', 'You have power over your mind, not outside events. Realize this, and you will find strength.', 'Marcus Aurelius'], ['calm', 'He suffers more than necessary who suffers before it is necessary.', 'Seneca'],
  ['calm', 'Nature does not hurry, yet everything is accomplished.', 'Laozi'], ['calm', 'The soul becomes dyed with the colour of its thoughts.', 'Marcus Aurelius'], ['calm', 'This too shall pass.', 'proverb'],
  ['calm', 'Silence is a source of great strength.', 'Laozi'], ['calm', 'Water is fluid, soft and yielding; yet it wears away the rock.', 'Laozi'],
  ['courage', 'Fortune favours the bold.', 'Virgil'], ['courage', 'It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult.', 'Seneca'],
  ['courage', 'The best way out is always through.', 'Robert Frost'], ['courage', 'Courage is knowing what not to fear.', 'Plato'], ['courage', 'He who fears he shall suffer, already suffers what he fears.', 'Montaigne'],
  ['curiosity', 'The only true wisdom is in knowing you know nothing.', 'Socrates'], ['curiosity', 'Wonder is the beginning of wisdom.', 'Socrates'], ['curiosity', 'The world is a book, and those who do not travel read only a page.', 'Saint Augustine'],
  ['curiosity', 'Not all those who wander are lost.', 'J.R.R. Tolkien'], ['curiosity', 'Live as if you were to die tomorrow. Learn as if you were to live forever.', 'attrib. Gandhi'],
  ['perspective', 'Waste no more time arguing what a good man should be. Be one.', 'Marcus Aurelius'], ['perspective', 'Life is long enough, if you know how to use it.', 'Seneca'],
  ['perspective', 'The obstacle is the way.', 'after Marcus Aurelius'], ['perspective', 'A man is rich in proportion to the number of things he can afford to let alone.', 'Thoreau'],
  ['perspective', 'Very little is needed to make a happy life.', 'Marcus Aurelius'], ['perspective', 'Today is the first day of the rest of your life.', 'proverb'],
];
export const pickQuote = (seed, cat) => { const pool = QUOTES.filter(q => !cat || q[0] === cat); let n = 0; for (const c of String(seed)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return pool[n % pool.length]; };
