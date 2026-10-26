// Diagnostic control recognition remains separate from product acceptance.
export function assessPageerrorControl(report,failure){
 const expected='pageerror: button sensitivity pageerror';
 const detectorObserved=report.status==='failed'&&report.errors.includes(expected)&&(report.clicks||[]).some(click=>click.trusted&&click.action==='act:settings');
 const expectedFailure='AssertionError [ERR_ASSERTION]: Native button safety detected '+expected;
 const primaryExpected=[report.failure,failure].every(value=>typeof value==='string'&&value.split('\n')[0]===expectedFailure);
 const executionValid=primaryExpected&&report.errors.length===1&&report.errors[0]===expected&&['contextClosed','browserClosed','serverClosed'].every(key=>report.cleanup?.[key]===true);
 return{detectorObserved,executionValid,detectorPassed:detectorObserved&&executionValid};
}
