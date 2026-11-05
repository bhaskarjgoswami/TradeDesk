import contextlib
import sqlite3
import pytest
from app.journal import core, workspace

@pytest.fixture
def profile_store(monkeypatch,tmp_path):
    path=tmp_path/'profile.sqlite'
    @contextlib.contextmanager
    def connect():
        conn=sqlite3.connect(path);conn.row_factory=sqlite3.Row
        try:
            with conn:yield conn
        finally:conn.close()
    monkeypatch.setattr(core,'db',connect)
    core.init_db();core.init_day_logs();core.init_plan_settings();core.init_routine();workspace.init(connect)
    return connect

@pytest.mark.parametrize('language',['en','hi','es','fr','de','pt','ar','zh-CN'])
def test_onboarding_answers_round_trip_with_profile_and_survive_other_edits(profile_store,language):
    state=workspace.read_settings(profile_store,'profile')
    state['settings'].update(firstName='Alex',language=language,country='IN',gender='woman',ageGroup='25-34',tradingLevel='professional',onboardingCompleted=True,onboardingVersion=1)
    saved=workspace.save_settings(profile_store,'profile',state)
    assert saved['settings']['language']==language
    assert saved['settings']['gender']=='woman'
    assert saved['settings']['ageGroup']=='25-34'
    assert saved['settings']['tradingLevel']=='professional'
    assert saved['settings']['onboardingCompleted'] is True
    saved['settings']['bio']='My private journal'
    updated=workspace.save_settings(profile_store,'profile',saved)
    assert updated['settings']['onboardingCompleted'] is True
    assert workspace.read_settings(profile_store,'profile')==updated
    with pytest.raises(workspace.Conflict):workspace.save_settings(profile_store,'profile',state)

@pytest.mark.parametrize('field,value',[('language','xx'),('language',[]),('gender','invalid'),('ageGroup',26),('tradingLevel','admin'),('onboardingCompleted','true'),('onboardingVersion',True),('onboardingVersion',999)])
def test_invalid_profile_preferences_are_rejected_without_writes(profile_store,field,value):
    state=workspace.read_settings(profile_store,'profile')
    state['settings'][field]=value
    with pytest.raises(ValueError):workspace.save_settings(profile_store,'profile',state)
    assert workspace.read_settings(profile_store,'profile')['revision']==0

def test_skip_can_complete_with_all_personal_fields_empty_and_old_profiles_still_save(profile_store):
    state=workspace.read_settings(profile_store,'profile')
    state['settings']={'firstName':'Existing'}
    saved=workspace.save_settings(profile_store,'profile',state)
    assert saved['settings']['language']==''
    saved['settings'].update(onboardingCompleted=True,onboardingVersion=1,language='en')
    done=workspace.save_settings(profile_store,'profile',saved)
    assert done['settings']['gender']==''
    assert done['settings']['ageGroup']==''
    assert done['settings']['tradingLevel']==''
    assert done['settings']['onboardingCompleted'] is True
