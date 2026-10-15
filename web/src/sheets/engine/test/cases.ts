/**
 * Formulas and the result Excel gives for them, against one fixture sheet. The
 * first block is spike S1's table, carried over; the rest extends it.
 *
 * Data!: A mixed types, B text, C numbers, D1 a date, E:F sorted keys, G:H text
 * keys, J1:M2 a horizontal table. Keys is Data!$E$1:$E$5. TODAY is 15 June 2024.
 */

type V = number | string | boolean;

export const FIXTURE: [string, V][] = [
  ...([10, 20, '30', true, null, 40] as const).flatMap((v, i) => (v === null ? [] : [[`A${i + 1}`, v] as [string, V]])),
  ...(['apple', 'Banana', 'cherry', 'apple pie', null, 'date'] as const).flatMap((v, i) => (v === null ? [] : [[`B${i + 1}`, v] as [string, V]])),
  ...[1.5, -2.5, 3, 4, 5, 6].map((v, i) => [`C${i + 1}`, v] as [string, V]),
  ...['one', 'two', 'three', 'four', 'five'].flatMap((v, i) => [[`E${i + 1}`, i + 1], [`F${i + 1}`, v]] as [string, V][]),
  ...['red', 'green', 'blue'].flatMap((v, i) => [[`G${i + 1}`, v], [`H${i + 1}`, i + 1]] as [string, V][]),
  ...['q1', 'q2', 'q3', 'q4'].flatMap((v, i) => [[`${'JKLM'[i]}1`, v], [`${'JKLM'[i]}2`, (i + 1) * 100]] as [string, V][])
];
export const FIXTURE_FORMULAS: [string, string][] = [['D1', '=DATE(2024,1,15)']];
export const NAMES: [string, string][] = [['Keys', 'Data!$E$1:$E$5']];
/** 15 June 2024, 12:00 UTC. */
export const NOW_MS = Date.UTC(2024, 5, 15, 12, 0, 0);

const E = (code: string) => ({ error: code });

export const CASES: [string, unknown][] = [
  // ---------------------------------------------------------------- spike S1
  // operators and precedence
  ['=-2^2', 4], ['=2^3^2', 64], ['=1+2*3', 7], ['="a"&1+1', 'a2'], ['=1<2=TRUE', true], ['=50%', 0.5],
  ['=10/4', 2.5], ['="abc"<"ABD"', true], ['=TRUE>1', true], ['="1"+1', 2], ['="a"+1', E('#VALUE!')],
  ['=1/0', E('#DIV/0!')], ['=FOO(1)', E('#NAME?')], ['=A5', 0], ['=NoSuchName', E('#NAME?')],
  ['=#N/A+1', E('#N/A')], ['=0^0', E('#NUM!')], ['=SUM(Keys)', 15], ['=Sheet2!A1', 0],
  // aggregates: a range ignores text and logicals, an argument coerces them
  ['=SUM(A1:A6)', 70], ['=SUM(10,"30",TRUE)', 41], ['=SUM("abc")', E('#VALUE!')], ['=SUM(A1,1/0)', E('#DIV/0!')],
  ['=AVERAGE(A1:A6)', 70 / 3], ['=AVERAGE(A5)', E('#DIV/0!')], ['=COUNT(A1:A6)', 3], ['=COUNTA(A1:A6)', 5],
  ['=COUNTBLANK(A1:A6)', 1], ['=MIN(C1:C6)', -2.5], ['=MAX(C1:C6)', 6], ['=PRODUCT(C3:C5)', 60],
  ['=COUNTIF(A1:A6,">15")', 2], ['=COUNTIF(B1:B6,"apple*")', 2], ['=COUNTIF(B1:B6,"a?ple")', 1],
  ['=COUNTIF(B1:B6,"<>apple")', 5], ['=COUNTIFS(A1:A6,">5",C1:C6,">0")', 2], ['=SUMIF(A1:A6,">15",C1:C6)', 3.5],
  ['=SUMIFS(C1:C6,B1:B6,"apple*")', 5.5], ['=AVERAGEIF(A1:A6,">0")', 70 / 3], ['=SUMPRODUCT(E1:E5,E1:E5)', 55],
  // logic
  ['=IF(A1>5,"big","small")', 'big'], ['=IF(FALSE,1)', false], ['=IFS(A1>100,"a",A1>5,"b")', 'b'],
  ['=IFS(FALSE,1)', E('#N/A')], ['=IFERROR(1/0,"x")', 'x'], ['=IFNA(VLOOKUP(99,E1:F5,2,FALSE),"none")', 'none'],
  ['=AND(TRUE,1,A1>5)', true], ['=OR(FALSE,0)', false], ['=NOT(0)', true], ['=AND("x")', E('#VALUE!')],
  ['=CHOOSE(2,"a","b","c")', 'b'], ['=IF(TRUE,1,1/0)', 1],
  // lookup
  ['=VLOOKUP(3,E1:F5,2,FALSE)', 'three'], ['=VLOOKUP(3.5,E1:F5,2)', 'three'], ['=VLOOKUP(0,E1:F5,2)', E('#N/A')],
  ['=VLOOKUP(3,E1:F5,3,FALSE)', E('#REF!')], ['=VLOOKUP("BLUE",G1:H3,2,FALSE)', 3], ['=VLOOKUP("gr*",G1:H3,2,FALSE)', 2],
  ['=HLOOKUP("q3",J1:M2,2,FALSE)', 300], ['=XLOOKUP(4,E1:E5,F1:F5)', 'four'], ['=XLOOKUP(9,E1:E5,F1:F5,"nf")', 'nf'],
  ['=XLOOKUP(3.5,E1:E5,F1:F5,,-1)', 'three'], ['=XLOOKUP(3.5,E1:E5,F1:F5,,1)', 'four'], ['=XLOOKUP(9,E1:E5,F1:F5)', E('#N/A')],
  ['=INDEX(E1:F5,2,2)', 'two'], ['=INDEX(E1:E5,4)', 4], ['=INDEX(E1:F5,9,1)', E('#REF!')], ['=SUM(INDEX(E1:F5,0,1))', 15],
  ['=MATCH(4,E1:E5,0)', 4], ['=MATCH(3.5,E1:E5)', 3], ['=MATCH("blue",G1:G3,0)', 3], ['=MATCH(0,E1:E5)', E('#N/A')],
  ['=ROWS(E1:F5)', 5], ['=COLUMNS(E1:F5)', 2], ['=ROW(E3)', 3], ['=COLUMN(F1)', 6],
  // maths
  ['=ROUND(2.675,2)', 2.68], ['=ROUND(-2.5,0)', -3], ['=ROUND(1234.5,-2)', 1200], ['=ROUNDUP(1.21,1)', 1.3],
  ['=ROUNDDOWN(-1.29,1)', -1.2], ['=ABS(-3)', 3], ['=INT(-1.5)', -2], ['=MOD(-3,2)', 1], ['=MOD(1,0)', E('#DIV/0!')],
  ['=SQRT(-1)', E('#NUM!')], ['=POWER(2,10)', 1024],
  // text
  ['=LEN("héllo")', 5], ['=LEFT("abc",2)', 'ab'], ['=LEFT("abc")', 'a'], ['=RIGHT("abc",2)', 'bc'], ['=MID("abcdef",2,3)', 'bcd'],
  ['=MID("abc",0,1)', E('#VALUE!')], ['=CONCAT(B1:B2,"!")', 'appleBanana!'], ['=CONCATENATE("a",1,TRUE)', 'a1TRUE'],
  ['=TEXTJOIN(", ",TRUE,B1:B6)', 'apple, Banana, cherry, apple pie, date'], ['=TEXTJOIN("-",FALSE,"a","","b")', 'a--b'],
  ['=UPPER("abc")', 'ABC'], ['=LOWER("ABC")', 'abc'], ['=TRIM("  a   b  ")', 'a b'], ['=TEXT(1234.5,"#,##0.00")', '1,234.50'],
  ['=TEXT(D1,"yyyy-mm-dd")', '2024-01-15'], ['=TEXT(0.256,"0%")', '26%'], ['=VALUE("1,234.5")', 1234.5], ['=VALUE("abc")', E('#VALUE!')],
  // dates (1900 system, with its fictional 29 February)
  ['=D1', 45306], ['=DATE(2024,14,1)', 45689], ['=DATE(1900,1,1)', 1], ['=DATE(1900,3,1)', 61], ['=YEAR(D1)', 2024],
  ['=MONTH(D1)', 1], ['=DAY(D1)', 15], ['=DAY(60)', 29], ['=MONTH(60)', 2], ['=TODAY()', 45458], ['=NOW()>=TODAY()', true],
  // information
  ['=ISBLANK(A5)', true], ['=ISNUMBER(A3)', false], ['=ISTEXT(A3)', true], ['=ISERROR(1/0)', true], ['=ISNA(NA())', true],
  // were formulajs in the spike
  ['=MEDIAN(C1:C6)', 3.5], ['=STDEV.S(E1:E5)', 1.5811388300841898], ['=PMT(0.05/12,360,200000)', -1073.6432460242797],
  ['=EOMONTH(D1,1)', 45351], ['=SUBSTITUTE("a-b-c","-","+")', 'a+b+c'], ['=DATEDIF(DATE(2020,1,1),DATE(2024,6,1),"y")', 4],
  ['=WEEKDAY(D1)', 2],

  // ---------------------------------------------------------------- operators and coercion
  ['=0.1+0.2=0.3', true], ['="A"="a"', true], ['=""=A5', true], ['=A5=0', true], ['=-A1', -10], ['=2*-3', -6],
  ['=10%*10', 1], ['=1&TRUE', '1TRUE'], ['="x"&1/0', E('#DIV/0!')], ['={1,2;3,4}', 1], ['=SUM({1,2;3,4})', 10],
  ['=1/3&""', '0.333333333333333'], ['=LEN(1/3)', 17], ['=-"2"', -2], ['="3"*"4"', 12], ['=A4+1', 2],
  ['=B1>A1', true], ['=A4>B1', true], ['=(1+2)*3', 9], ['=2^-1', 0.5], ['=0^-1', E('#DIV/0!')],
  ['=#REF!', E('#REF!')], ['=1E+300*1E+300', E('#NUM!')],
  // array evaluation inside a range argument, without Ctrl+Shift+Enter
  ['=SUMPRODUCT((A1:A6>15)*1)', 4], ['=SUM(IF(C1:C6>2,C1:C6))', 18], ['=SUMPRODUCT((B1:B6="apple")*C1:C6)', 1.5],
  ['=SUMPRODUCT(--(B1:B6="apple"))', 1], ['=SUM(CHOOSE({1,2},10,20))', 30], ['=CHOOSE({1,2},10,20)', 10],
  ['=SUM(LEN(F1:F5))', 19], ['=SUM(E1:E5*{1;0;1;0;1})', 9], ['=MAX(IFERROR(1/(E1:E5-3),0))', 1],
  ['=SUM((E1:E2,E4:E5))', 12], ['=COUNT((E1:E2,E4:E5))', 4], ['=SUM(E1:INDEX(E1:E5,3))', 6],
  ['=INDEX((E1:E5,G1:H3),2,2,2)', 2], ['=ROWS((E1:E5))', 5],

  // ---------------------------------------------------------------- maths
  ['=MROUND(10,3)', 9], ['=CEILING(2.5,1)', 3], ['=FLOOR(-2.5,-2)', -2], ['=CEILING.MATH(-2.5)', -2], ['=FLOOR.MATH(-2.5)', -3],
  ['=TRUNC(-8.9)', -8], ['=SIGN(-5)', -1], ['=EVEN(1.5)', 2], ['=ODD(2)', 3], ['=GCD(24,36)', 12], ['=LCM(4,6)', 12],
  ['=FACT(5)', 120], ['=COMBIN(5,2)', 10], ['=PERMUT(5,2)', 20], ['=QUOTIENT(7,2)', 3], ['=LOG(100)', 2], ['=LOG(8,2)', 3],
  ['=LN(EXP(2))', 2], ['=SUMSQ(3,4)', 25], ['=ROUND(-1.5,0)', -2], ['=ROUND(0.5,0)', 1], ['=MOD(3,-2)', -1],
  ['=PRODUCT(A1:A6)', 8000], ['=PI()', Math.PI], ['=DEGREES(PI())', 180], ['=SIN(0)', 0], ['=ATAN2(1,1)', Math.PI / 4],
  ['=SQRTPI(1)', Math.sqrt(Math.PI)], ['=ROUNDUP(-1.21,1)', -1.3], ['=INT(5)', 5], ['=MOD(5.5,1)', 0.5],

  // ---------------------------------------------------------------- statistics
  ['=MEDIAN(A1:A6)', 20], ['=MODE(1,2,2,3,3)', 2], ['=MODE(1,2,3)', E('#N/A')], ['=LARGE(C1:C6,2)', 5], ['=SMALL(C1:C6,1)', -2.5],
  ['=LARGE(C1:C6,7)', E('#NUM!')], ['=RANK(4,C1:C6)', 3], ['=RANK(4,C1:C6,1)', 4], ['=PERCENTILE(E1:E5,0.25)', 2],
  ['=QUARTILE(E1:E5,3)', 4], ['=STDEV.P(E1:E5)', Math.SQRT2], ['=VAR.S(E1:E5)', 2.5], ['=VAR.P(E1:E5)', 2],
  ['=AVERAGEIFS(C1:C6,A1:A6,">5")', 5 / 3], ['=MAXIFS(C1:C6,A1:A6,">5")', 6], ['=MINIFS(C1:C6,A1:A6,">5")', -2.5],
  ['=COUNTIF(A1:A6,30)', 1], ['=COUNTIF(A1:A6,TRUE)', 1], ['=COUNTIF(B1:B6,"")', 1], ['=SUMIF(B1:B6,"apple",C1:C6)', 1.5],
  ['=AVERAGEIF(A1:A6,">15",C1:C6)', 1.75], ['=SUMIF(A1:A6,">15")', 60],
  ['=COUNTIF(B1:B6,"*e*")', 4], ['=COUNTIF(C1:C6,"<=3")', 3], ['=SUMIF(C1:C6,">"&C3)', 15],
  ['=SLOPE({2,4,6},{1,2,3})', 2], ['=INTERCEPT({2,4,6},{1,2,3})', 0], ['=CORREL({1,2,3},{2,4,7})', 5 / Math.sqrt(76 / 3)],
  ['=FORECAST(4,{2,4,6},{1,2,3})', 8], ['=SUBTOTAL(9,C1:C6)', 17], ['=SUBTOTAL(109,C1:C6)', 17], ['=SUBTOTAL(2,A1:A6)', 3],
  ['=GEOMEAN(1,4)', 2], ['=HARMEAN(1,4)', 1.6], ['=AVEDEV(E1:E5)', 1.2], ['=DEVSQ(E1:E5)', 10], ['=AVERAGEA(A1:A6)', 71 / 5],
  ['=COUNTA(1,"",FALSE)', 3], ['=MAXA(A4,0)', 1], ['=COVARIANCE.P({1,2,3},{1,2,3})', 2 / 3],

  // ---------------------------------------------------------------- logic
  ['=XOR(TRUE,TRUE)', false], ['=XOR(TRUE,FALSE,FALSE)', true], ['=SWITCH(2,1,"a",2,"b","c")', 'b'], ['=SWITCH(9,1,"a","z")', 'z'],
  ['=SWITCH(9,1,"a")', E('#N/A')], ['=IF(A5,1,2)', 2], ['=CHOOSE(3,"a","b")', E('#VALUE!')], ['=IFERROR(#N/A,"x")', 'x'],
  ['=IFNA(1/0,"x")', E('#DIV/0!')], ['=AND(A1:A6)', true], ['=OR(A5)', E('#VALUE!')], ['=IF(1,,2)', 0], ['=TRUE()', true],
  ['=IFS(1,"a",1/0,"b")', 'a'],

  // ---------------------------------------------------------------- lookup
  ['=XLOOKUP("q2",J1:M1,J2:M2)', 200], ['=XLOOKUP("*rr*",B1:B6,C1:C6,,2)', 3], ['=XLOOKUP(5,E1:E5,F1:F5,,0,-1)', 'five'],
  ['=XMATCH(3,E1:E5)', 3], ['=XMATCH(3.5,E1:E5,1)', 4], ['=INDEX(J1:M2,2,MATCH("q4",J1:M1,0))', 400],
  ['=VLOOKUP("apple",B1:C6,2,FALSE)', 1.5], ['=VLOOKUP("APPLE PIE",B1:C6,2,0)', 4], ['=LOOKUP(3.5,E1:E5,F1:F5)', 'three'],
  ['=LOOKUP(2,E1:F5)', 'two'], ['=MATCH(5,E1:E5,1)', 5], ['=MATCH("b*",B1:B6,0)', 2], ['=MATCH(6,E1:E5)', 5],
  ['=HLOOKUP("q",J1:M2,2)', E('#N/A')], ['=SUM(XLOOKUP(2,E1:E5,E1:F5))', 2],
  ['=SUM(INDEX(E1:F5,3,0))', 3], ['=COLUMN()', 14], ['=ROWS({1,2;3,4})', 2],

  // ---------------------------------------------------------------- text
  ['=PROPER("hello wORLD")', 'Hello World'], ['=FIND("b","abcb")', 2], ['=FIND("B","abc")', E('#VALUE!')], ['=FIND("b","abcb",3)', 4],
  ['=SEARCH("B","abc")', 2], ['=SEARCH("c*","abcd")', 3], ['=SEARCH("?c","abcd")', 2], ['=SUBSTITUTE("aaa","a","b",2)', 'aba'],
  ['=REPLACE("abcdef",2,3,"X")', 'aXef'], ['=REPT("ab",3)', 'ababab'], ['=EXACT("a","A")', false], ['=CHAR(65)', 'A'],
  ['=CODE("a")', 97], ['=UNICODE("€")', 8364], ['=UNICHAR(8364)', '€'], ['=CHAR(128)', '€'],
  ['=TEXT(0.5,"h:mm AM/PM")', '12:00 PM'], ['=TEXT(1234567.891,"#,##0.0")', '1,234,567.9'], ['=TEXT(-5,"0;(0)")', '(5)'],
  ['=TEXT(45306,"dddd d mmmm yyyy")', 'Monday 15 January 2024'], ['=TEXT("12","00.0")', '12.0'], ['=FIXED(1234.567,1)', '1,234.6'],
  ['=FIXED(1234.567,-1,TRUE)', '1230'], ['=TEXTBEFORE("a-b-c","-")', 'a'], ['=TEXTAFTER("a-b-c","-",-1)', 'c'],
  ['=TEXTBEFORE("abc","x")', E('#N/A')], ['=TEXTAFTER("abc","x",,,,"none")', 'none'], ['=T(1)', ''], ['=T("a")', 'a'],
  ['=N("a")', 0], ['=N(TRUE)', 1], ['=NUMBERVALUE("1.234,5",",",".")', 1234.5], ['=VALUE("15/01/2024")', 45306],
  ['=VALUE("50%")', 0.5], ['=CONCAT({"a","b";"c","d"})', 'abcd'], ['=CLEAN("a"&CHAR(7)&"b")', 'ab'], ['=LEN("")', 0],
  ['=MID("abc",2,10)', 'bc'], ['=LEFT("abc",-1)', E('#VALUE!')], ['=REPT("x",0)', ''], ['=TEXTJOIN(",",TRUE,{"a","";"b","c"})', 'a,b,c'],

  // ---------------------------------------------------------------- dates and times
  ['=DATE(2024,2,29)', 45351], ['=DATE(2023,2,29)', 44986], ['=DATE(1900,2,29)', 60], ['=DATE(1900,2,28)', 59],
  ['=DATE(24,1,1)', 8767], ['=DATE(10000,1,1)', E('#NUM!')], ['=DATE(2024,1,0)', 45291],
  ['=EDATE(DATE(2024,1,31),1)', 45351], ['=EOMONTH(D1,-1)', 45291], ['=WEEKDAY(D1,2)', 1], ['=WEEKDAY(D1,3)', 0],
  ['=WEEKDAY(1)', 1], ['=WEEKNUM(D1)', 3], ['=WEEKNUM(D1,21)', 3], ['=ISOWEEKNUM(DATE(2021,1,3))', 53],
  ['=DATEDIF(DATE(2020,1,15),DATE(2024,6,1),"m")', 52], ['=DATEDIF(DATE(2024,1,1),DATE(2023,1,1),"d")', E('#NUM!')],
  ['=DATEDIF(DATE(2024,1,15),DATE(2024,3,10),"yd")', 55], ['=DAYS(DATE(2024,3,1),DATE(2024,2,1))', 29],
  ['=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,31))', 23], ['=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,31),DATE(2024,1,1))', 22],
  ['=NETWORKDAYS(DATE(2024,1,31),DATE(2024,1,1))', -23], ['=WORKDAY(DATE(2024,1,5),1)', 45299], ['=WORKDAY(DATE(2024,1,8),-1)', 45296],
  ['=TIME(25,0,0)', 1 / 24], ['=TIME(12,0,0)', 0.5], ['=HOUR(0.75)', 18], ['=MINUTE(TIME(1,30,0))', 30], ['=SECOND(TIME(0,0,59))', 59],
  ['=NOW()', 45458.5], ['=YEAR("2024-03-05")', 2024], ['=TIMEVALUE("18:00")', 0.75], ['=DATEVALUE("2024-01-15")', 45306],
  ['=DATEVALUE("15 Jan 2024")', 45306], ['=D1+1', 45307], ['="2024-01-16"-D1', 1], ['=YEAR(-1)', E('#NUM!')], ['=MONTH(DATE(2024,12,31))', 12],

  // ---------------------------------------------------------------- information
  ['=ISLOGICAL(A4)', true], ['=ISREF(A1)', true], ['=ISREF(1)', false], ['=ISFORMULA(D1)', true], ['=ISFORMULA(A1)', false],
  ['=TYPE(A3)', 2], ['=TYPE(E1:E2)', 64], ['=TYPE(1/0)', 16], ['=ERROR.TYPE(1/0)', 2], ['=ERROR.TYPE(1)', E('#N/A')],
  ['=ISEVEN(4)', true], ['=ISODD(-3)', true], ['=ISERR(NA())', false], ['=ISNONTEXT(A5)', true], ['=NA()', E('#N/A')],

  // ---------------------------------------------------------------- the long tail, through formulajs
  ['=FV(0.05,10,-100)', 1257.7892535548839], ['=DEC2BIN(10)', '1010'], ['=BIN2DEC("1010")', 10], ['=NORM.S.DIST(0,TRUE)', 0.5],
  ['=NPV(0.1,100,100)', 173.55371900826447], ['=FOOBAR.BAZ(1)', E('#NAME?')]
];
