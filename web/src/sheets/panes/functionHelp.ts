/**
 * What the Insert function dialog says about each function: its category, its arguments and what
 * they mean. A lazy chunk, loaded when the dialog opens, because it is some 25 KB that nobody needs
 * until they look a function up.
 *
 * One line per function: `NAME|category|arguments|what it does|argument: meaning; argument: meaning`.
 * An argument in square brackets is optional, and `…` says the last one repeats. The signature the
 * dialog shows is built from the arguments, so the two cannot disagree.
 *
 * Functions the engine has that are not here (the long tail of statistics, engineering and finance)
 * are still listed and insertable, under "Other", without help.
 */

export type Category = 'Math and trig' | 'Statistical' | 'Logical' | 'Lookup and reference' | 'Text' | 'Date and time' | 'Information' | 'Financial' | 'Engineering';

const CATEGORIES: Record<string, Category> = {
  m: 'Math and trig',
  s: 'Statistical',
  l: 'Logical',
  r: 'Lookup and reference',
  t: 'Text',
  d: 'Date and time',
  i: 'Information',
  f: 'Financial',
  e: 'Engineering'
};

export const CATEGORY_ORDER: readonly Category[] = ['Math and trig', 'Statistical', 'Logical', 'Lookup and reference', 'Text', 'Date and time', 'Information', 'Financial', 'Engineering'];

export interface FunctionHelp {
  name: string;
  category: Category;
  args: { name: string; optional: boolean; text: string }[];
  /** `SUM(number1, [number2], …)`. */
  signature: string;
  text: string;
}

const RAW = `
ABS|m|number|Returns a number without its sign.|number:The number to make positive.
ACOS|m|number|Returns the angle, in radians, whose cosine is a number.|number:A cosine, from -1 to 1.
ACOSH|m|number|Returns the inverse hyperbolic cosine of a number.|number:A number of 1 or more.
ASIN|m|number|Returns the angle, in radians, whose sine is a number.|number:A sine, from -1 to 1.
ASINH|m|number|Returns the inverse hyperbolic sine of a number.|number:Any number.
ATAN|m|number|Returns the angle, in radians, whose tangent is a number.|number:A tangent.
ATAN2|m|x_num, y_num|Returns the angle, in radians, from the x axis to the point (x, y).|x_num:The x coordinate of the point.;y_num:The y coordinate of the point.
ATANH|m|number|Returns the inverse hyperbolic tangent of a number.|number:A number between -1 and 1.
CEILING|m|number, significance|Rounds a number up to the nearest multiple of a significance.|number:The number to round.;significance:The multiple to round up to.
CEILING.MATH|m|number, [significance], [mode]|Rounds a number up to the nearest integer or multiple, away from zero for a negative if mode is set.|number:The number to round.;significance:The multiple to round up to. The default is 1.;mode:For a negative number, 0 rounds toward zero and anything else away from it.
COMBIN|m|number, number_chosen|Returns how many ways there are to choose items from a set, ignoring order.|number:How many items there are.;number_chosen:How many to choose.
COS|m|angle|Returns the cosine of an angle.|angle:An angle in radians.
COSH|m|number|Returns the hyperbolic cosine of a number.|number:Any number.
DEGREES|m|angle|Converts radians to degrees.|angle:An angle in radians.
EVEN|m|number|Rounds a number away from zero to the nearest even integer.|number:The number to round.
EXP|m|number|Returns e raised to a power.|number:The exponent.
FACT|m|number|Returns the factorial of a number.|number:A whole number of 0 or more.
FLOOR|m|number, significance|Rounds a number down to the nearest multiple of a significance.|number:The number to round.;significance:The multiple to round down to.
FLOOR.MATH|m|number, [significance], [mode]|Rounds a number down to the nearest integer or multiple.|number:The number to round.;significance:The multiple to round down to. The default is 1.;mode:For a negative number, 0 rounds away from zero and anything else toward it.
GCD|m|number1, [number2], …|Returns the greatest common divisor of whole numbers.|number1:The first whole number.;number2:More whole numbers.
INT|m|number|Rounds a number down to the nearest integer.|number:The number to round down.
LCM|m|number1, [number2], …|Returns the least common multiple of whole numbers.|number1:The first whole number.;number2:More whole numbers.
LN|m|number|Returns the natural logarithm of a number.|number:A positive number.
LOG|m|number, [base]|Returns the logarithm of a number to a base.|number:A positive number.;base:The base. The default is 10.
LOG10|m|number|Returns the base 10 logarithm of a number.|number:A positive number.
MOD|m|number, divisor|Returns the remainder after a number is divided.|number:The number to divide.;divisor:The number to divide by.
MROUND|m|number, multiple|Rounds a number to the nearest multiple.|number:The number to round.;multiple:The multiple to round to.
ODD|m|number|Rounds a number away from zero to the nearest odd integer.|number:The number to round.
PI|m||Returns the value of pi, 3.14159265358979.|
POWER|m|number, power|Raises a number to a power.|number:The base.;power:The exponent.
PRODUCT|m|number1, [number2], …|Multiplies the numbers in the arguments and ranges.|number1:A number or range.;number2:More numbers or ranges.
QUOTIENT|m|numerator, denominator|Returns the whole part of a division.|numerator:The number to divide.;denominator:The number to divide by.
RADIANS|m|angle|Converts degrees to radians.|angle:An angle in degrees.
RAND|m||Returns a random number from 0 up to, not including, 1, and a new one each time the sheet recalculates.|
RANDBETWEEN|m|bottom, top|Returns a random whole number between two numbers, and a new one each time the sheet recalculates.|bottom:The smallest number it can be.;top:The largest number it can be.
ROUND|m|number, num_digits|Rounds a number to a number of digits.|number:The number to round.;num_digits:How many digits after the point. Negative rounds to the left of it.
ROUNDDOWN|m|number, num_digits|Rounds a number toward zero.|number:The number to round.;num_digits:How many digits after the point. Negative rounds to the left of it.
ROUNDUP|m|number, num_digits|Rounds a number away from zero.|number:The number to round.;num_digits:How many digits after the point. Negative rounds to the left of it.
SIGN|m|number|Returns 1 for a positive number, 0 for zero and -1 for a negative one.|number:Any number.
SIN|m|angle|Returns the sine of an angle.|angle:An angle in radians.
SINH|m|number|Returns the hyperbolic sine of a number.|number:Any number.
SQRT|m|number|Returns the positive square root of a number.|number:A number of 0 or more.
SQRTPI|m|number|Returns the square root of a number times pi.|number:A number of 0 or more.
SUBTOTAL|m|function_num, ref1, [ref2], …|Returns a subtotal of a range, skipping other subtotals inside it.|function_num:Which calculation: 1 average, 2 count, 3 counta, 4 max, 5 min, 6 product, 9 sum.;ref1:The range to calculate over.;ref2:More ranges.
SUM|m|number1, [number2], …|Adds the numbers in the arguments and ranges.|number1:A number or range to add.;number2:More numbers or ranges.
SUMIF|m|range, criteria, [sum_range]|Adds the cells that meet a condition.|range:The cells to test.;criteria:The condition, such as 10, ">5" or "apples".;sum_range:The cells to add, if they are not the ones tested.
SUMIFS|m|sum_range, criteria_range1, criteria1, …|Adds the cells that meet every one of several conditions.|sum_range:The cells to add.;criteria_range1:The first range to test.;criteria1:The condition for it. More pairs may follow.
SUMPRODUCT|m|array1, [array2], …|Multiplies ranges item by item and adds the products.|array1:The first range or array.;array2:More ranges of the same size.
SUMSQ|m|number1, [number2], …|Adds the squares of the numbers.|number1:A number or range.;number2:More numbers or ranges.
TAN|m|angle|Returns the tangent of an angle.|angle:An angle in radians.
TANH|m|number|Returns the hyperbolic tangent of a number.|number:Any number.
TRUNC|m|number, [num_digits]|Cuts a number off at a number of digits, without rounding.|number:The number to cut.;num_digits:How many digits to keep after the point. The default is 0.
ROMAN|m|number, [form]|Writes a number as a Roman numeral.|number:A whole number from 1 to 3999.;form:How concise it is, from 0 classic to 4 simplified.
ARABIC|m|text|Reads a Roman numeral as a number.|text:The Roman numeral.
BASE|m|number, radix, [min_length]|Writes a number in another base.|number:A whole number of 0 or more.;radix:The base, from 2 to 36.;min_length:The fewest characters, padded with zeros.
AVEDEV|s|number1, [number2], …|Returns the average distance of values from their mean.|number1:A number or range.;number2:More numbers or ranges.
AVERAGE|s|number1, [number2], …|Returns the average of the numbers in the arguments and ranges.|number1:A number or range.;number2:More numbers or ranges.
AVERAGEA|s|value1, [value2], …|Returns the average, counting text as 0 and TRUE as 1.|value1:A value or range.;value2:More values or ranges.
AVERAGEIF|s|range, criteria, [average_range]|Averages the cells that meet a condition.|range:The cells to test.;criteria:The condition.;average_range:The cells to average, if they are not the ones tested.
AVERAGEIFS|s|average_range, criteria_range1, criteria1, …|Averages the cells that meet every one of several conditions.|average_range:The cells to average.;criteria_range1:The first range to test.;criteria1:The condition for it. More pairs may follow.
CORREL|s|array1, array2|Returns the correlation between two sets of values.|array1:The first range.;array2:The second range, the same size.
COUNT|s|value1, [value2], …|Counts the cells that hold numbers.|value1:A value or range.;value2:More values or ranges.
COUNTA|s|value1, [value2], …|Counts the cells that are not empty.|value1:A value or range.;value2:More values or ranges.
COUNTBLANK|s|range|Counts the empty cells in a range.|range:The cells to count.
COUNTIF|s|range, criteria|Counts the cells that meet a condition.|range:The cells to test.;criteria:The condition, such as 10, ">5" or "apples".
COUNTIFS|s|criteria_range1, criteria1, …|Counts the cells that meet every one of several conditions.|criteria_range1:The first range to test.;criteria1:The condition for it. More pairs may follow.
COVAR|s|array1, array2|Returns the covariance of two sets, as for a whole population.|array1:The first range.;array2:The second range, the same size.
COVARIANCE.P|s|array1, array2|Returns the population covariance of two sets.|array1:The first range.;array2:The second range, the same size.
COVARIANCE.S|s|array1, array2|Returns the sample covariance of two sets.|array1:The first range.;array2:The second range, the same size.
DEVSQ|s|number1, [number2], …|Returns the sum of the squares of each value's distance from the mean.|number1:A number or range.;number2:More numbers or ranges.
FORECAST|s|x, known_ys, known_xs|Predicts a value along a straight line through known pairs.|x:The x to predict for.;known_ys:The known y values.;known_xs:The known x values.
FORECAST.LINEAR|s|x, known_ys, known_xs|Predicts a value along a straight line through known pairs.|x:The x to predict for.;known_ys:The known y values.;known_xs:The known x values.
GEOMEAN|s|number1, [number2], …|Returns the geometric mean of positive numbers.|number1:A number or range.;number2:More numbers or ranges.
HARMEAN|s|number1, [number2], …|Returns the harmonic mean of positive numbers.|number1:A number or range.;number2:More numbers or ranges.
INTERCEPT|s|known_ys, known_xs|Returns where the best-fit line crosses the y axis.|known_ys:The known y values.;known_xs:The known x values.
LARGE|s|array, k|Returns the k-th largest value in a set.|array:The values.;k:Which largest: 1 is the largest.
MAX|s|number1, [number2], …|Returns the largest number.|number1:A number or range.;number2:More numbers or ranges.
MAXA|s|value1, [value2], …|Returns the largest value, counting text as 0 and TRUE as 1.|value1:A value or range.;value2:More values or ranges.
MAXIFS|s|max_range, criteria_range1, criteria1, …|Returns the largest value among the cells that meet every condition.|max_range:The cells to take the largest of.;criteria_range1:The first range to test.;criteria1:The condition for it. More pairs may follow.
MEDIAN|s|number1, [number2], …|Returns the middle number of a set.|number1:A number or range.;number2:More numbers or ranges.
MIN|s|number1, [number2], …|Returns the smallest number.|number1:A number or range.;number2:More numbers or ranges.
MINA|s|value1, [value2], …|Returns the smallest value, counting text as 0 and TRUE as 1.|value1:A value or range.;value2:More values or ranges.
MINIFS|s|min_range, criteria_range1, criteria1, …|Returns the smallest value among the cells that meet every condition.|min_range:The cells to take the smallest of.;criteria_range1:The first range to test.;criteria1:The condition for it. More pairs may follow.
MODE|s|number1, [number2], …|Returns the most frequent number.|number1:A number or range.;number2:More numbers or ranges.
MODE.SNGL|s|number1, [number2], …|Returns the most frequent number.|number1:A number or range.;number2:More numbers or ranges.
PEARSON|s|array1, array2|Returns the Pearson correlation coefficient of two sets.|array1:The first range.;array2:The second range, the same size.
PERCENTILE|s|array, k|Returns the k-th percentile of a set.|array:The values.;k:A fraction from 0 to 1.
PERCENTILE.EXC|s|array, k|Returns the k-th percentile, leaving out 0 and 1.|array:The values.;k:A fraction between 0 and 1, exclusive.
PERCENTILE.INC|s|array, k|Returns the k-th percentile of a set.|array:The values.;k:A fraction from 0 to 1.
PERMUT|s|number, number_chosen|Returns how many ordered arrangements of some items there are.|number:How many items there are.;number_chosen:How many in each arrangement.
QUARTILE|s|array, quart|Returns a quartile of a set.|array:The values.;quart:0 the smallest, 1 first quartile, 2 median, 3 third quartile, 4 the largest.
QUARTILE.EXC|s|array, quart|Returns a quartile, leaving out the smallest and largest.|array:The values.;quart:1, 2 or 3.
QUARTILE.INC|s|array, quart|Returns a quartile of a set.|array:The values.;quart:0 to 4.
RANK|s|number, ref, [order]|Returns where a number stands in a list.|number:The number to find.;ref:The list of numbers.;order:0 or left out ranks the largest first; anything else the smallest first.
RANK.AVG|s|number, ref, [order]|Returns where a number stands in a list, sharing the average rank among ties.|number:The number to find.;ref:The list of numbers.;order:0 or left out ranks the largest first; anything else the smallest first.
RANK.EQ|s|number, ref, [order]|Returns where a number stands in a list; ties share the top rank.|number:The number to find.;ref:The list of numbers.;order:0 or left out ranks the largest first; anything else the smallest first.
RSQ|s|known_ys, known_xs|Returns the square of the Pearson correlation of two sets.|known_ys:The known y values.;known_xs:The known x values.
SLOPE|s|known_ys, known_xs|Returns the slope of the best-fit line.|known_ys:The known y values.;known_xs:The known x values.
SMALL|s|array, k|Returns the k-th smallest value in a set.|array:The values.;k:Which smallest: 1 is the smallest.
STDEV|s|number1, [number2], …|Returns the standard deviation of a sample.|number1:A number or range.;number2:More numbers or ranges.
STDEV.P|s|number1, [number2], …|Returns the standard deviation of a whole population.|number1:A number or range.;number2:More numbers or ranges.
STDEV.S|s|number1, [number2], …|Returns the standard deviation of a sample.|number1:A number or range.;number2:More numbers or ranges.
STDEVA|s|value1, [value2], …|Returns the standard deviation of a sample, counting text as 0 and TRUE as 1.|value1:A value or range.;value2:More values or ranges.
STDEVP|s|number1, [number2], …|Returns the standard deviation of a whole population.|number1:A number or range.;number2:More numbers or ranges.
STDEVPA|s|value1, [value2], …|Returns the standard deviation of a population, counting text as 0 and TRUE as 1.|value1:A value or range.;value2:More values or ranges.
VAR|s|number1, [number2], …|Returns the variance of a sample.|number1:A number or range.;number2:More numbers or ranges.
VAR.P|s|number1, [number2], …|Returns the variance of a whole population.|number1:A number or range.;number2:More numbers or ranges.
VAR.S|s|number1, [number2], …|Returns the variance of a sample.|number1:A number or range.;number2:More numbers or ranges.
VARA|s|value1, [value2], …|Returns the variance of a sample, counting text as 0 and TRUE as 1.|value1:A value or range.;value2:More values or ranges.
VARP|s|number1, [number2], …|Returns the variance of a whole population.|number1:A number or range.;number2:More numbers or ranges.
VARPA|s|value1, [value2], …|Returns the variance of a population, counting text as 0 and TRUE as 1.|value1:A value or range.;value2:More values or ranges.
AND|l|logical1, [logical2], …|Returns TRUE when every argument is TRUE.|logical1:A condition or range.;logical2:More conditions.
FALSE|l||Returns the logical value FALSE.|
IF|l|logical_test, value_if_true, [value_if_false]|Returns one value if a condition is true and another if it is not.|logical_test:The condition to test.;value_if_true:What to return when it is true.;value_if_false:What to return when it is false. The default is FALSE.
IFERROR|l|value, value_if_error|Returns a value, or another if the first is an error.|value:The value to check.;value_if_error:What to return if it is an error.
IFNA|l|value, value_if_na|Returns a value, or another if the first is #N/A.|value:The value to check.;value_if_na:What to return if it is #N/A.
IFS|l|logical_test1, value_if_true1, …|Returns the value for the first condition that is true.|logical_test1:The first condition.;value_if_true1:What to return when it is true. More pairs may follow.
NOT|l|logical|Reverses TRUE and FALSE.|logical:A condition.
OR|l|logical1, [logical2], …|Returns TRUE when any argument is TRUE.|logical1:A condition or range.;logical2:More conditions.
SWITCH|l|expression, value1, result1, …, [default]|Compares a value with a list and returns the result of the first match.|expression:The value to compare.;value1:The first value to match.;result1:What to return for it. More pairs may follow.;default:What to return when nothing matches.
TRUE|l||Returns the logical value TRUE.|
XOR|l|logical1, [logical2], …|Returns TRUE when an odd number of arguments are TRUE.|logical1:A condition or range.;logical2:More conditions.
CHOOSE|r|index_num, value1, [value2], …|Returns the value at a position in a list.|index_num:Which value, starting at 1.;value1:The first value.;value2:More values.
COLUMN|r|[reference]|Returns the column number of a reference.|reference:The cell. The cell the formula is in if left out.
COLUMNS|r|array|Returns how many columns a range has.|array:The range.
HLOOKUP|r|lookup_value, table_array, row_index_num, [range_lookup]|Finds a value in the top row of a table and returns a value from the same column.|lookup_value:What to find.;table_array:The table.;row_index_num:Which row of the table to return a value from.;range_lookup:FALSE for an exact match. The default, TRUE, finds the closest smaller one in sorted data.
INDEX|r|array, row_num, [column_num]|Returns the value at a row and column of a range.|array:The range.;row_num:The row within it.;column_num:The column within it.
LOOKUP|r|lookup_value, lookup_vector, [result_vector]|Finds a value in a sorted row or column and returns the value at the same position in another.|lookup_value:What to find.;lookup_vector:The sorted row or column to search.;result_vector:The row or column to return from.
MATCH|r|lookup_value, lookup_array, [match_type]|Returns the position of a value in a range.|lookup_value:What to find.;lookup_array:The row or column to search.;match_type:0 for an exact match, 1 for the largest not above it in sorted data, -1 for the smallest not below it.
ROW|r|[reference]|Returns the row number of a reference.|reference:The cell. The cell the formula is in if left out.
ROWS|r|array|Returns how many rows a range has.|array:The range.
VLOOKUP|r|lookup_value, table_array, col_index_num, [range_lookup]|Finds a value in the first column of a table and returns a value from the same row.|lookup_value:What to find.;table_array:The table.;col_index_num:Which column of the table to return a value from.;range_lookup:FALSE for an exact match. The default, TRUE, finds the closest smaller one in sorted data.
XLOOKUP|r|lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]|Finds a value in a row or column and returns the value at the same position in another.|lookup_value:What to find.;lookup_array:The row or column to search.;return_array:The row or column to return from.;if_not_found:What to return when there is no match.;match_mode:0 exact, -1 exact or next smaller, 1 exact or next larger, 2 wildcards.;search_mode:1 first to last, -1 last to first.
XMATCH|r|lookup_value, lookup_array, [match_mode], [search_mode]|Returns the position of a value in a row or column.|lookup_value:What to find.;lookup_array:The row or column to search.;match_mode:0 exact, -1 exact or next smaller, 1 exact or next larger, 2 wildcards.;search_mode:1 first to last, -1 last to first.
CHAR|t|number|Returns the character for a code number.|number:A code from 1 to 255.
CLEAN|t|text|Removes the characters that cannot be printed.|text:The text to clean.
CODE|t|text|Returns the code number of the first character.|text:The text.
CONCAT|t|text1, [text2], …|Joins text from arguments and ranges.|text1:Text or a range.;text2:More text or ranges.
CONCATENATE|t|text1, [text2], …|Joins pieces of text into one.|text1:The first piece.;text2:More pieces.
EXACT|t|text1, text2|Returns TRUE when two texts are identical, including case.|text1:The first text.;text2:The second text.
FIND|t|find_text, within_text, [start_num]|Returns where a text starts inside another, respecting case.|find_text:The text to find.;within_text:The text to search.;start_num:Where to start. The default is 1.
FIXED|t|number, [decimals], [no_commas]|Writes a number as text with a fixed number of decimals.|number:The number.;decimals:How many places after the point. The default is 2.;no_commas:TRUE to leave out thousands separators.
LEFT|t|text, [num_chars]|Returns characters from the start of a text.|text:The text.;num_chars:How many. The default is 1.
LEN|t|text|Returns how many characters a text has.|text:The text.
LOWER|t|text|Makes text lower case.|text:The text.
MID|t|text, start_num, num_chars|Returns characters from the middle of a text.|text:The text.;start_num:The position of the first character to take, from 1.;num_chars:How many to take.
NUMBERVALUE|t|text, [decimal_separator], [group_separator]|Reads text as a number in a given format.|text:The text.;decimal_separator:The character used for the decimal point.;group_separator:The character used for thousands.
PROPER|t|text|Capitalises the first letter of each word.|text:The text.
REPLACE|t|old_text, start_num, num_chars, new_text|Replaces part of a text, by position.|old_text:The text.;start_num:The position of the first character to replace.;num_chars:How many characters to replace.;new_text:What to put there.
REPT|t|text, number_times|Repeats a text.|text:The text.;number_times:How many times.
RIGHT|t|text, [num_chars]|Returns characters from the end of a text.|text:The text.;num_chars:How many. The default is 1.
SEARCH|t|find_text, within_text, [start_num]|Returns where a text starts inside another, ignoring case and allowing wildcards.|find_text:The text to find.;within_text:The text to search.;start_num:Where to start. The default is 1.
SUBSTITUTE|t|text, old_text, new_text, [instance_num]|Replaces matching text inside a text.|text:The text.;old_text:The text to replace.;new_text:What to put in its place.;instance_num:Which match to replace. Every match if left out.
T|t|value|Returns the value if it is text, and an empty text otherwise.|value:Any value.
TEXT|t|value, format_text|Writes a value as text in a number format.|value:A number.;format_text:The format, such as "0.00" or "dd/mm/yyyy".
TEXTAFTER|t|text, delimiter, [instance_num]|Returns the text after a delimiter.|text:The text.;delimiter:What to look for.;instance_num:Which occurrence. Negative counts from the end.
TEXTBEFORE|t|text, delimiter, [instance_num]|Returns the text before a delimiter.|text:The text.;delimiter:What to look for.;instance_num:Which occurrence. Negative counts from the end.
TEXTJOIN|t|delimiter, ignore_empty, text1, [text2], …|Joins text with a delimiter between the pieces.|delimiter:What goes between them.;ignore_empty:TRUE to skip empty cells.;text1:Text or a range.;text2:More text or ranges.
TRIM|t|text|Removes extra spaces, leaving one between words.|text:The text.
UNICHAR|t|number|Returns the character for a Unicode number.|number:A Unicode code point.
UNICODE|t|text|Returns the Unicode number of the first character.|text:The text.
UPPER|t|text|Makes text upper case.|text:The text.
VALUE|t|text|Reads text as a number.|text:Text that looks like a number, a date or a time.
DATE|d|year, month, day|Builds a date from a year, a month and a day.|year:The year.;month:The month, 1 to 12. More or fewer carries into the year.;day:The day. More or fewer carries into the month.
DATEDIF|d|start_date, end_date, unit|Returns the time between two dates in years, months or days.|start_date:The earlier date.;end_date:The later date.;unit:"Y" years, "M" months, "D" days, "MD" days ignoring months, "YM" months ignoring years, "YD" days ignoring years.
DATEVALUE|d|date_text|Reads a date written as text.|date_text:The text.
DAY|d|serial_number|Returns the day of the month of a date.|serial_number:A date.
DAYS|d|end_date, start_date|Returns the number of days between two dates.|end_date:The later date.;start_date:The earlier date.
EDATE|d|start_date, months|Returns the date some months before or after a date.|start_date:The date.;months:How many months to add. Negative goes back.
EOMONTH|d|start_date, months|Returns the last day of the month some months before or after a date.|start_date:The date.;months:How many months to add. Negative goes back.
HOUR|d|serial_number|Returns the hour of a time.|serial_number:A time.
ISOWEEKNUM|d|date|Returns the ISO week number of a date.|date:The date.
MINUTE|d|serial_number|Returns the minute of a time.|serial_number:A time.
MONTH|d|serial_number|Returns the month of a date, 1 to 12.|serial_number:A date.
NETWORKDAYS|d|start_date, end_date, [holidays]|Returns the number of working days between two dates.|start_date:The first date.;end_date:The last date.;holidays:Dates to leave out.
NOW|d||Returns the date and time now, and again each time the sheet recalculates.|
SECOND|d|serial_number|Returns the second of a time.|serial_number:A time.
TIME|d|hour, minute, second|Builds a time from an hour, a minute and a second.|hour:The hour.;minute:The minute.;second:The second.
TIMEVALUE|d|time_text|Reads a time written as text.|time_text:The text.
TODAY|d||Returns today's date, and a new one each day.|
WEEKDAY|d|serial_number, [return_type]|Returns the day of the week of a date.|serial_number:A date.;return_type:1 Sunday is 1 (the default), 2 Monday is 1, 3 Monday is 0.
WEEKNUM|d|serial_number, [return_type]|Returns the week of the year of a date.|serial_number:A date.;return_type:1 weeks start on Sunday (the default), 2 on Monday.
WORKDAY|d|start_date, days, [holidays]|Returns the date some working days before or after a date.|start_date:The date.;days:How many working days to add. Negative goes back.;holidays:Dates to leave out.
YEAR|d|serial_number|Returns the year of a date.|serial_number:A date.
YEARFRAC|d|start_date, end_date, [basis]|Returns the fraction of a year between two dates.|start_date:The earlier date.;end_date:The later date.;basis:How days are counted: 0 US 30/360 (the default), 1 actual, 2 actual/360, 3 actual/365, 4 European 30/360.
DAYS360|d|start_date, end_date, [method]|Returns the days between two dates on a 360-day year.|start_date:The earlier date.;end_date:The later date.;method:FALSE for the US method (the default), TRUE for the European.
ERROR.TYPE|i|error_val|Returns a number for the kind of error.|error_val:An error value.
ISBLANK|i|value|Returns TRUE for an empty cell.|value:The cell.
ISERR|i|value|Returns TRUE for any error except #N/A.|value:The value.
ISERROR|i|value|Returns TRUE for any error.|value:The value.
ISEVEN|i|number|Returns TRUE for an even number.|number:The number.
ISFORMULA|i|reference|Returns TRUE when a cell holds a formula.|reference:The cell.
ISLOGICAL|i|value|Returns TRUE for TRUE or FALSE.|value:The value.
ISNA|i|value|Returns TRUE for #N/A.|value:The value.
ISNONTEXT|i|value|Returns TRUE for anything that is not text.|value:The value.
ISNUMBER|i|value|Returns TRUE for a number.|value:The value.
ISODD|i|number|Returns TRUE for an odd number.|number:The number.
ISREF|i|value|Returns TRUE for a reference.|value:The value.
ISTEXT|i|value|Returns TRUE for text.|value:The value.
N|i|value|Returns a value as a number: a number as it is, TRUE as 1, anything else 0.|value:The value.
NA|i||Returns the error #N/A.|
TYPE|i|value|Returns a number for the kind of value: 1 number, 2 text, 4 logical, 16 error.|value:The value.
FV|f|rate, nper, pmt, [pv], [type]|Returns the future value of regular payments at a fixed rate.|rate:The interest rate for each period.;nper:How many periods.;pmt:The payment each period, negative for money paid out.;pv:The present value. The default is 0.;type:0 payments at the end of a period (the default), 1 at the start.
IRR|f|values, [guess]|Returns the internal rate of return of a series of cash flows.|values:The cash flows, at least one positive and one negative.;guess:A first guess at the rate. The default is 10%.
NPER|f|rate, pmt, pv, [fv], [type]|Returns how many periods an investment or loan lasts.|rate:The interest rate for each period.;pmt:The payment each period.;pv:The present value.;fv:The future value. The default is 0.;type:0 payments at the end of a period (the default), 1 at the start.
NPV|f|rate, value1, [value2], …|Returns the net present value of cash flows at a discount rate.|rate:The discount rate for each period.;value1:The first cash flow, at the end of period 1.;value2:More cash flows.
PMT|f|rate, nper, pv, [fv], [type]|Returns the payment for a loan at a fixed rate.|rate:The interest rate for each period.;nper:How many payments.;pv:The amount borrowed.;fv:The balance left after the last payment. The default is 0.;type:0 payments at the end of a period (the default), 1 at the start.
PV|f|rate, nper, pmt, [fv], [type]|Returns the present value of regular payments.|rate:The interest rate for each period.;nper:How many periods.;pmt:The payment each period.;fv:The future value. The default is 0.;type:0 payments at the end of a period (the default), 1 at the start.
RATE|f|nper, pmt, pv, [fv], [type], [guess]|Returns the interest rate of each period of a loan or investment.|nper:How many periods.;pmt:The payment each period.;pv:The present value.;fv:The future value. The default is 0.;type:0 payments at the end of a period (the default), 1 at the start.;guess:A first guess at the rate. The default is 10%.
SLN|f|cost, salvage, life|Returns straight-line depreciation for one period.|cost:What the asset cost.;salvage:What it is worth at the end.;life:How many periods it lasts.
DEC2BIN|e|number, [places]|Converts a decimal number to binary.|number:A whole number.;places:How many characters, padded with zeros.
BIN2DEC|e|number|Converts a binary number to decimal.|number:A binary number.
DEC2HEX|e|number, [places]|Converts a decimal number to hexadecimal.|number:A whole number.;places:How many characters, padded with zeros.
HEX2DEC|e|number|Converts a hexadecimal number to decimal.|number:A hexadecimal number.
`;

const parsed: FunctionHelp[] = RAW.split('\n')
  .filter((l) => l.trim() !== '')
  .map((line) => {
    const [name = '', cat = '', args = '', text = '', argText = ''] = line.split('|');
    const help = new Map(
      argText
        .split(';')
        .filter(Boolean)
        .map((p) => {
          const i = p.indexOf(':');
          return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
        })
    );
    const list = args
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a !== '' && a !== '…')
      .map((a) => {
        const optional = a.startsWith('[');
        const bare = a.replace(/[[\]]/g, '');
        return { name: bare, optional, text: help.get(bare) ?? '' };
      });
    return {
      name,
      category: CATEGORIES[cat] ?? 'Math and trig',
      args: list,
      signature: `${name}(${args})`,
      text
    };
  });

/** Every function that has help, by name. */
export const FUNCTION_HELP: ReadonlyMap<string, FunctionHelp> = new Map(parsed.map((f) => [f.name, f]));
